import { createServer } from "node:http";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ImpactMessage, PresenceMessage } from "./protocol.js";
import type { KnownFile } from "./providers/provider.js";
import { impactTouches } from "./match.js";
import { upsertIndex, removeIndex } from "./index-store.js";
import { loadHistory, saveHistory } from "./history-store.js";
import { analyze, selectProvider } from "./analyzer.js";

const PORT = Number(process.env.PORT ?? 7077);
const MAX_PAYLOAD = 512 * 1024; // 인바운드 메시지 상한 (DoS 방지)
const MAX_CLIENTS = 200;
const MAX_FILES_PER_CLIENT = 5000;
const RIPPLE_SECRET = (process.env.RIPPLE_SECRET ?? "").trim();
// 비밀이 담길 만한 파일은 분석(특히 외부 LLM 전송)에서 제외.
const SECRET_FILE = /(^|\/)\.env|\.(pem|key|p12|pfx)$|secret|credential/i;

const provider = selectProvider();

// 어떤 비동기 경로에서 새는 예외도 프로세스를 죽이지 않게.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason instanceof Error ? reason.message : String(reason));
});

interface Client {
  userId: string;
  repo: string;
  files: Set<string>;
  index: KnownFile[];
}

const clients = new Map<WebSocket, Client>();
let impactSeq = 0;

/** 최근 영향 분석 결과 링버퍼 — 늦게 접속한 사람에게 "놓친 변경" 을 백필한다. 디스크 영속. */
const HISTORY_MAX = 50;
const HISTORY_FILE = process.env.RIPPLE_HISTORY ?? resolve(process.cwd(), ".ripple-history.json");
const history: ImpactMessage[] = loadHistory(HISTORY_FILE, HISTORY_MAX);

/** 잦은 디스크 쓰기 방지를 위한 디바운스 저장. */
const HISTORY_SAVE_DEBOUNCE_MS = 1000;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persistHistory(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveHistory(HISTORY_FILE, history), HISTORY_SAVE_DEBOUNCE_MS);
}

/** 모든 클라이언트가 들고 있는 파일의 합집합 = 영향 분석 후보군. */
function knownFiles(): string[] {
  const all = new Set<string>();
  for (const c of clients.values()) for (const f of c.files) all.add(`${c.repo}/${f}`);
  return [...all];
}

/** 모든 클라이언트 인덱스의 합집합 (path 는 `${repo}/${rel}` 로 정규화). */
function knownIndex(): KnownFile[] {
  const byPath = new Map<string, KnownFile>();
  for (const c of clients.values()) for (const kf of c.index) byPath.set(kf.path, kf);
  return [...byPath.values()];
}

function broadcast(msg: ImpactMessage): void {
  const payload = JSON.stringify(msg);
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

/** 접속자 목록을 전원에게 — userId+repo 중복 제거. (register 직후 unknown 은 제외) */
function broadcastPresence(): void {
  const seen = new Set<string>();
  const peers: PresenceMessage["peers"] = [];
  for (const c of clients.values()) {
    if (c.userId === "unknown") continue;
    const key = `${c.userId}@${c.repo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    peers.push({ userId: c.userId, repo: c.repo });
  }
  const payload = JSON.stringify({ type: "presence", peers } satisfies PresenceMessage);
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

const isStr = (v: unknown): v is string => typeof v === "string";

/** 외부 입력 검증 — 필수 필드까지 확인해야 핸들러에서 undefined 가 안 샌다. */
function parse(raw: string): ClientMessage | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  if (obj.type === "register" && isStr(obj.userId) && isStr(obj.repo) && Array.isArray(obj.files)) {
    return obj as unknown as ClientMessage;
  }
  if (obj.type === "change" && isStr(obj.userId) && isStr(obj.repo) && isStr(obj.file) && isStr(obj.diff)) {
    return obj as unknown as ClientMessage;
  }
  if (obj.type === "index" && isStr(obj.repo) && isStr(obj.path) && (obj.op === "upsert" || obj.op === "remove")) {
    return obj as unknown as ClientMessage;
  }
  return null;
}

async function handleChange(
  msg: Extract<ClientMessage, { type: "change" }>,
): Promise<void> {
  // 비밀 파일은 분석/전송하지 않는다 (특히 외부 LLM 으로 diff 유출 방지).
  if (SECRET_FILE.test(msg.file)) {
    console.log(`[skip] 비밀 파일 분석 제외: ${msg.repo}/${msg.file}`);
    return;
  }
  const { result, usedProvider } = await analyze(provider, {
    repo: msg.repo,
    file: msg.file,
    diff: msg.diff,
    knownFiles: knownFiles(),
    knownIndex: knownIndex(),
  });

  const impact: ImpactMessage = {
    type: "impact",
    id: `imp_${++impactSeq}`,
    author: msg.userId,
    repo: msg.repo,
    file: msg.file,
    summary: result.summary,
    severity: result.severity,
    affected: result.affected,
    ts: Date.now(),
  };

  history.push(impact);
  if (history.length > HISTORY_MAX) history.shift();
  persistHistory();

  console.log(
    `[change] ${msg.userId} ${msg.repo}/${msg.file} ` +
      `→ ${impact.severity} · 영향 ${impact.affected.length}건 (${usedProvider})`,
  );
  broadcast(impact);
}

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, provider: provider.name, clients: clients.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server: http,
  maxPayload: MAX_PAYLOAD,
  // RIPPLE_SECRET 가 설정돼 있으면 Bearer 토큰 검증 (미설정 시 로컬용으로 개방).
  verifyClient: (info: { req: import("node:http").IncomingMessage }) => {
    if (!RIPPLE_SECRET) return true;
    return info.req.headers["authorization"] === `Bearer ${RIPPLE_SECRET}`;
  },
});

wss.on("connection", (ws) => {
  if (clients.size >= MAX_CLIENTS) {
    ws.close(1013, "server full");
    return;
  }
  clients.set(ws, { userId: "unknown", repo: "unknown", files: new Set(), index: [] });

  ws.on("message", (data) => {
    const msg = parse(data.toString());
    if (!msg) return;

    if (msg.type === "register") {
      const index: KnownFile[] = (msg.index ?? []).slice(0, MAX_FILES_PER_CLIENT).map((fi) => ({
        path: `${msg.repo}/${fi.path}`,
        exports: fi.exports ?? [],
        imports: fi.imports ?? [],
        refs: fi.refs ?? [],
      }));
      clients.set(ws, {
        userId: msg.userId,
        repo: msg.repo,
        files: new Set(msg.files.slice(0, MAX_FILES_PER_CLIENT)),
        index,
      });
      console.log(
        `[register] ${msg.userId} @ ${msg.repo} (${msg.files.length} files, ${index.length} indexed)`,
      );

      // 놓친 변경 백필: 이 사람 파일을 가리키는 최근 영향만, 본인 변경 제외하고 replay.
      const fullFiles = new Set(msg.files.map((f) => `${msg.repo}/${f}`));
      const missed = history.filter(
        (h) => h.author !== msg.userId && impactTouches(h, fullFiles),
      );
      for (const h of missed) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ...h, replay: true }));
      }
      if (missed.length > 0) console.log(`  ↳ ${msg.userId} 에게 놓친 영향 ${missed.length}건 백필`);
      broadcastPresence();
      return;
    }

    if (msg.type === "change") {
      // 등록 정보로 files/인덱스 갱신 → 분석 후보가 세션 중에도 최신으로 유지됨.
      const c = clients.get(ws);
      if (c) {
        c.files.add(msg.file);
        if (msg.index && typeof msg.index === "object") {
          c.index = upsertIndex(c.index, {
            path: `${msg.repo}/${msg.file}`,
            exports: msg.index.exports ?? [],
            imports: msg.index.imports ?? [],
            refs: msg.index.refs ?? [],
          });
        }
      }
      handleChange(msg).catch((err) =>
        console.error("[change] 처리 실패:", err instanceof Error ? err.message : String(err)),
      );
    }

    if (msg.type === "index") {
      const c = clients.get(ws);
      if (c) {
        const full = `${msg.repo}/${msg.path}`;
        if (msg.op === "remove") {
          c.index = removeIndex(c.index, full);
          c.files.delete(msg.path);
        } else if (msg.index) {
          c.files.add(msg.path);
          c.index = upsertIndex(c.index, {
            path: full,
            exports: msg.index.exports ?? [],
            imports: msg.index.imports ?? [],
            refs: msg.index.refs ?? [],
          });
        }
      }
    }
  });

  ws.on("close", () => {
    const c = clients.get(ws);
    clients.delete(ws);
    if (c) {
      console.log(`[disconnect] ${c.userId}`);
      broadcastPresence();
    }
  });

  ws.on("error", (err) => console.error("[ws error]", err.message));
});

http.listen(PORT, () => {
  console.log(
    `🌊 Ripple 백엔드 가동 · ws://localhost:${PORT} · provider=${provider.name}` +
      (history.length > 0 ? ` · 히스토리 ${history.length}건 복원` : ""),
  );
  if (provider.name === "mock") {
    console.log("   (ANTHROPIC_API_KEY 없음 → 휴리스틱 mock 사용. 키 넣으면 Claude 분석)");
  }
});

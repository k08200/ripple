import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ImpactMessage } from "./protocol.js";
import { analyze, selectProvider } from "./analyzer.js";

const PORT = Number(process.env.PORT ?? 7077);
const provider = selectProvider();

interface Client {
  userId: string;
  repo: string;
  files: Set<string>;
}

const clients = new Map<WebSocket, Client>();
let impactSeq = 0;

/** 모든 클라이언트가 들고 있는 파일의 합집합 = 영향 분석 후보군. */
function knownFiles(): string[] {
  const all = new Set<string>();
  for (const c of clients.values()) for (const f of c.files) all.add(`${c.repo}/${f}`);
  return [...all];
}

function broadcast(msg: ImpactMessage): void {
  const payload = JSON.stringify(msg);
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function parse(raw: string): ClientMessage | null {
  try {
    const obj = JSON.parse(raw) as ClientMessage;
    if (obj && (obj.type === "register" || obj.type === "change")) return obj;
    return null;
  } catch {
    return null;
  }
}

async function handleChange(
  msg: Extract<ClientMessage, { type: "change" }>,
): Promise<void> {
  const { result, usedProvider } = await analyze(provider, {
    repo: msg.repo,
    file: msg.file,
    diff: msg.diff,
    knownFiles: knownFiles(),
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

const wss = new WebSocketServer({ server: http });

wss.on("connection", (ws) => {
  clients.set(ws, { userId: "unknown", repo: "unknown", files: new Set() });

  ws.on("message", (data) => {
    const msg = parse(data.toString());
    if (!msg) return;

    if (msg.type === "register") {
      clients.set(ws, {
        userId: msg.userId,
        repo: msg.repo,
        files: new Set(msg.files),
      });
      console.log(`[register] ${msg.userId} @ ${msg.repo} (${msg.files.length} files)`);
      return;
    }

    if (msg.type === "change") {
      // 등록 정보로 files 갱신해두면 분석 후보가 최신으로 유지됨.
      const c = clients.get(ws);
      if (c) c.files.add(msg.file);
      void handleChange(msg);
    }
  });

  ws.on("close", () => {
    const c = clients.get(ws);
    clients.delete(ws);
    if (c) console.log(`[disconnect] ${c.userId}`);
  });

  ws.on("error", (err) => console.error("[ws error]", err.message));
});

http.listen(PORT, () => {
  console.log(`🌊 Ripple 백엔드 가동 · ws://localhost:${PORT} · provider=${provider.name}`);
  if (provider.name === "mock") {
    console.log("   (ANTHROPIC_API_KEY 없음 → 휴리스틱 mock 사용. 키 넣으면 Claude 분석)");
  }
});

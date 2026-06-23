import * as os from "node:os";
import * as http from "node:http";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import * as vscode from "vscode";
import { WebSocket } from "ws";
import { shouldAutoStart, parsePort, electionDelayMs } from "./autostart";
import { normalizeTeam } from "./team";
import { discoverBrain } from "./discovery";
import { lineDiff } from "./diff";
import { FeedViewProvider, openByHint } from "./feedView";
import type { UseSite } from "./feedView";
import { extractIndex } from "./indexer";
import { locateUseSites } from "./usesite";
import type { ChangeMessage, FileIndex, ImpactMessage, IndexMessage, PresenceMessage, RegisterMessage, ServerMessage } from "./protocol";

const CODE_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,java,rb,php,cs,kt,swift,rs,vue,svelte,sql,proto}";
const IGNORE_GLOB = "**/{node_modules,.git,dist,build,out,.next,vendor}/**";
const MAX_FILES = 3000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10_000;
/** 선출 대기 후 그새 뜬 host 를 잡기 위한 재발견 창(ms). */
const DISCOVERY_RETRY_MS = 1200;

let socket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = RECONNECT_BASE_MS;
let output: vscode.OutputChannel;
let feed: FeedViewProvider;
let status: vscode.StatusBarItem;
let brainProc: ChildProcess | undefined;
let extContext: vscode.ExtensionContext;
const LOCAL_URL = "ws://localhost:7077";
/** 실제 연결할 주소 — 매 (재)연결마다 재해결(명시 설정 > LAN 발견 > 로컬 자동기동). */
let activeUrl = LOCAL_URL;
let connected = false;
/** 이번 세션에서 한 번이라도 붙은 적이 있나 — host 선출(재연결 시에만)과 콜드 스타트를 가른다. */
let everConnected = false;
let impactCount = 0;
let peers: PresenceMessage["peers"] = [];

/** 하단 상태바: 연결 상태 + 나에게 온 영향 건수 + 접속한 팀원 수를 한눈에. */
function updateStatus(): void {
  if (!status) return;
  if (connected) {
    const team = peers.length > 0 ? ` · 팀 ${peers.length}` : "";
    status.text = `$(pulse) Ripple${impactCount > 0 ? ` · 영향 ${impactCount}` : ""}${team}`;
    const who = peers.map((p) => `${p.userId}(${p.repo})`).join(", ");
    status.tooltip = `Ripple 연결됨${who ? ` · 접속: ${who}` : ""} — 클릭하면 변경 피드`;
    status.backgroundColor = impactCount > 0 ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  } else {
    status.text = "$(circle-slash) Ripple 끊김";
    status.tooltip = "Ripple 백엔드 연결 끊김 — 클릭하면 재연결";
    status.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  }
}

/** 저장 이전 내용 스냅샷 (fsPath -> text). diff 계산의 기준선. */
const snapshots = new Map<string, string>();
/** 내가 들고 있는 파일들 (`${repo}/${rel}`). 영향 매칭에 사용. */
const myFiles = new Set<string>();
/** rel 경로 → 심볼 인덱스. 한 번 스캔해 유지하고 저장/생성/삭제로 증분 갱신, 재연결 땐 재사용. */
const indexMap = new Map<string, FileIndex>();
let indexed = false;

/** 인덱스 한 항목 추가/갱신 — indexMap 과 myFiles 를 함께 유지. */
function setEntry(rel: string, idx: FileIndex): void {
  indexMap.set(rel, idx);
  myFiles.add(`${repoName()}/${rel}`);
}
function delEntry(rel: string): void {
  indexMap.delete(rel);
  myFiles.delete(`${repoName()}/${rel}`);
}

/** 워크스페이스를 한 번만 스캔해 인덱스를 채운다 (재연결 시엔 재사용). */
async function ensureIndexed(): Promise<void> {
  if (indexed) return;
  const uris = await vscode.workspace.findFiles(CODE_GLOB, IGNORE_GLOB, MAX_FILES);
  for (const u of uris) {
    const rel = vscode.workspace.asRelativePath(u, false);
    try {
      const bytes = await vscode.workspace.fs.readFile(u);
      setEntry(rel, extractIndex(rel, Buffer.from(bytes).toString("utf8")));
    } catch {
      /* 읽기 실패 파일은 생략 */
    }
  }
  indexed = true;
  log(`워크스페이스 인덱싱: ${indexMap.size}개 파일`);
}

function registerPayload(): { files: string[]; index: FileIndex[] } {
  return { files: [...indexMap.keys()], index: [...indexMap.values()] };
}

function userId(): string {
  const cfg = vscode.workspace.getConfiguration("ripple").get<string>("userId");
  return cfg && cfg.trim() ? cfg.trim() : os.userInfo().username || "anon";
}

function repoName(): string {
  return vscode.workspace.workspaceFolders?.[0]?.name ?? "workspace";
}

/** 팀 room — 같은 git 원격(=같은 프로젝트)이면 자동으로 같은 room. 설정 > git remote > repo 이름. */
function teamId(): string {
  const cfg = vscode.workspace.getConfiguration("ripple").get<string>("team");
  if (cfg && cfg.trim()) return cfg.trim();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root) {
    try {
      const url = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: root, encoding: "utf8" }).trim();
      if (url) return normalizeTeam(url);
    } catch {
      /* git 없음/원격 없음 → 폴백 */
    }
  }
  return repoName();
}

function backendUrl(): string {
  return vscode.workspace.getConfiguration("ripple").get<string>("backendUrl") ?? LOCAL_URL;
}

/** ms 만큼 쉰다 (선출 대기·기동 대기 공용). */
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 연결할 두뇌 주소 결정: 명시 설정(수동) > LAN 자동발견 > 로컬 자동기동. 재연결마다 재실행돼 자가치유. */
async function resolveBackendUrl(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("ripple");
  const explicit = (cfg.get<string>("backendUrl") ?? "").trim();
  if (explicit && explicit !== LOCAL_URL) {
    activeUrl = explicit; // 수동 설정 우선
    return;
  }
  if (cfg.get<boolean>("autoDiscover", true)) {
    const found = await discoverBrain(1200);
    if (found) {
      activeUrl = found;
      log(`LAN 두뇌 자동 발견: ${found}`);
      return;
    }
    // host 가 사라진 재연결이면, 모두가 동시에 발견 실패 → 각자 두뇌 기동 = split-brain.
    // 무작위 시간만큼 기다렸다 한 번 더 발견: 가장 짧게 뽑은 한 명만 host 가 되고
    // 나머지는 그새 뜬 host 에 붙는다(단일 host 로 수렴). 콜드 솔로 스타트(everConnected=false)는
    // 어차피 혼자라 선출이 무의미 → 생략해 온보딩 지연 0.
    if (everConnected && cfg.get<boolean>("autoStartBrain", true)) {
      await delay(electionDelayMs());
      const elected = await discoverBrain(DISCOVERY_RETRY_MS);
      if (elected) {
        activeUrl = elected;
        log(`LAN 두뇌 발견(host 선출 재시도): ${elected}`);
        return;
      }
    }
  }
  // 아무도 없으면 내가 로컬 두뇌를 띄운다 (= 먼저 켠/가장 짧게 뽑은 사람이 host, 나가면 다음 사람이 이어받음).
  activeUrl = LOCAL_URL;
  await maybeStartBrain(LOCAL_URL);
}

function isTracked(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== "file" || doc.isUntitled) return false;
  const rel = vscode.workspace.asRelativePath(doc.uri, false);
  return !/(^|\/)(node_modules|\.git|dist|build|out|\.next|vendor)\//.test(rel);
}

/** 로컬에 두뇌가 떠 있나? (자동기동 중복 방지) */
function brainAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** 로컬 모드면 번들된 두뇌를 자동으로 띄운다 → "설치만 하면 됨". 원격이면 안 띄움. */
async function maybeStartBrain(url: string): Promise<void> {
  const enabled = vscode.workspace.getConfiguration("ripple").get<boolean>("autoStartBrain", true);
  if (!shouldAutoStart(url, enabled)) return;
  const port = parsePort(url);
  if (await brainAlive(port)) return; // 이미 떠 있으면 그대로 사용

  const brainPath = vscode.Uri.joinPath(extContext.extensionUri, "dist", "brain.js").fsPath;
  try {
    // VS Code 의 node 런타임으로 실행 (PATH 의 node 에 의존하지 않음).
    brainProc = spawn(process.execPath, [brainPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port) },
      stdio: "ignore",
    });
    brainProc.on("error", (e) => log(`두뇌 자동기동 실패: ${e.message}`));
    log(`로컬 두뇌 자동 기동 (포트 ${port})`);
    if (process.platform === "win32") {
      log("Windows 방화벽이 네트워크 접근을 물으면 '허용' 하세요 (팀 연결에 필요).");
    }
    await delay(600); // 기동 잠깐 대기 (이후 connect 재시도가 마저 처리)
  } catch (e) {
    log(`두뇌 spawn 오류: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 솔로 온보딩: 가상 동료가 '내 열린 파일이 쓰는 심볼'을 바꾼 것처럼 시뮬레이트 → 풀 기능을 혼자 본다. */
function runDemo(): void {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc) {
    void vscode.window.showInformationMessage("🌊 Ripple 데모: 코드 파일을 하나 열고 다시 실행하세요.");
    return;
  }
  const m = doc.getText().match(/import\s*\{\s*([A-Za-z_$][\w$]*)[^}]*\}\s*from\s*['"]([^'"]+)['"]/);
  if (!m) {
    void vscode.window.showInformationMessage("🌊 Ripple 데모: 이 파일에 named import 가 없어요. import 가 있는 파일에서 실행하세요.");
    return;
  }
  const symbol = m[1];
  const moduleBase = (m[2].split("/").pop() ?? m[2]).replace(/\.[^.]+$/, "");
  const secret = vscode.workspace.getConfiguration("ripple").get<string>("secret")?.trim();
  const ws = new WebSocket(activeUrl, secret ? { headers: { authorization: `Bearer ${secret}` } } : undefined);
  const idx = { path: `${moduleBase}.ts`, exports: [symbol], imports: [], refs: [] };
  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "register", userId: "🌊 Ripple 데모", repo: "demo-teammate", files: [idx.path], index: [idx], team: teamId() }));
    setTimeout(() => {
      const diff = `@@\n-export function ${symbol}(value: number): void\n+export function ${symbol}(value: number, currency: string): Result`;
      ws.send(JSON.stringify({ type: "change", userId: "🌊 Ripple 데모", repo: "demo-teammate", file: `${moduleBase}.ts`, diff, index: idx }));
      setTimeout(() => ws.close(), 1000);
    }, 300);
  });
  ws.on("error", (e) => void vscode.window.showWarningMessage(`🌊 Ripple 데모: 두뇌 연결 실패 (${e.message}).`));
  void vscode.window.showInformationMessage(`🌊 Ripple 데모: 가상 동료가 '${symbol}()' 시그니처를 바꿉니다 — 알림/변경 피드를 보세요.`);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extContext = context;
  output = vscode.window.createOutputChannel("Ripple");
  feed = new FeedViewProvider();
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "ripple.showFeed";
  updateStatus();
  status.show();

  for (const doc of vscode.workspace.textDocuments) {
    if (isTracked(doc)) snapshots.set(doc.uri.fsPath, doc.getText());
  }

  context.subscriptions.push(
    output,
    status,
    vscode.window.registerWebviewViewProvider(FeedViewProvider.viewId, feed),
    vscode.commands.registerCommand("ripple.showFeed", () => {
      impactCount = 0;
      updateStatus();
      void vscode.commands.executeCommand("ripple.feed.focus");
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isTracked(doc)) snapshots.set(doc.uri.fsPath, doc.getText());
    }),
    vscode.workspace.onDidSaveTextDocument(onSave),
    createFileWatcher(),
    vscode.commands.registerCommand("ripple.reconnect", () => {
      log("수동 재연결");
      connect();
    }),
    vscode.commands.registerCommand("ripple.demo", runDemo),
    vscode.commands.registerCommand("ripple.reindex", async () => {
      indexed = false;
      indexMap.clear();
      myFiles.clear();
      await ensureIndexed();
      const { files, index } = registerPayload();
      send({ type: "register", userId: userId(), repo: repoName(), files, index, team: teamId() });
      log("수동 재인덱싱");
    }),
  );

  connect(); // 내부에서 주소 해결(명시>발견>로컬자동) 후 연결
  log(`Ripple 활성화 · user=${userId()} · repo=${repoName()}`);
}

export function deactivate(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.close();
  brainProc?.kill(); // 자동 기동한 로컬 두뇌도 같이 정리
}

function log(msg: string): void {
  output.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function send(obj: ChangeMessage | RegisterMessage | IndexMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj));
}

/** 파일 생성/삭제 시 그 항목만 인덱스에 즉시 반영 (세션 중 신규 파일도 분석 후보로). */
async function sendIndexOp(op: "upsert" | "remove", uri: vscode.Uri): Promise<void> {
  if (uri.scheme !== "file") return;
  const rel = vscode.workspace.asRelativePath(uri, false);
  if (/(^|\/)(node_modules|\.git|dist|build|out|\.next|vendor)\//.test(rel)) return;
  const repo = repoName();
  if (op === "remove") {
    delEntry(rel);
    snapshots.delete(uri.fsPath);
    send({ type: "index", repo, op: "remove", path: rel });
    log(`파일 삭제 반영: ${rel}`);
    return;
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const index = extractIndex(rel, Buffer.from(bytes).toString("utf8"));
    setEntry(rel, index);
    send({ type: "index", repo, op: "upsert", path: rel, index });
    log(`파일 생성 반영: ${rel}`);
  } catch {
    /* 읽기 실패 무시 */
  }
}

/** 코드 파일 생성/삭제 감시 → 인덱스 즉시 갱신. (편집은 onSave 가 처리) */
function createFileWatcher(): vscode.Disposable {
  const w = vscode.workspace.createFileSystemWatcher(CODE_GLOB);
  return vscode.Disposable.from(
    w,
    w.onDidCreate((uri) => void sendIndexOp("upsert", uri)),
    w.onDidDelete((uri) => void sendIndexOp("remove", uri)),
  );
}

function onSave(doc: vscode.TextDocument): void {
  if (!isTracked(doc)) return;
  const before = snapshots.get(doc.uri.fsPath) ?? doc.getText();
  const after = doc.getText();
  const diff = lineDiff(before, after);
  snapshots.set(doc.uri.fsPath, after);
  if (!diff) return; // 기준선과 동일 → 보낼 게 없음

  const rel = vscode.workspace.asRelativePath(doc.uri, false);
  const repo = repoName();
  // 저장된 파일의 인덱스를 새로 떠서 맵에 반영 + 백엔드로 동봉 전송 (세션 중에도 최신 유지).
  const index = extractIndex(rel, after);
  setEntry(rel, index);
  send({ type: "change", userId: userId(), repo, file: rel, diff, index });
  log(`변경 전송: ${rel}`);
}

async function connect(): Promise<void> {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.removeAllListeners();
  socket?.close();

  await resolveBackendUrl(); // 매 연결마다 재해결 → host 가 바뀌어도 자가치유
  const url = activeUrl;
  const secret = vscode.workspace.getConfiguration("ripple").get<string>("secret")?.trim();
  log(`연결 시도: ${url}`);
  const ws = new WebSocket(url, secret ? { headers: { authorization: `Bearer ${secret}` } } : undefined);
  socket = ws;

  ws.on("open", async () => {
    reconnectDelay = RECONNECT_BASE_MS;
    connected = true;
    everConnected = true;
    updateStatus();
    try {
      await ensureIndexed(); // 최초 1회만 스캔, 재연결 시 재사용
      const { files, index } = registerPayload();
      const reg: RegisterMessage = { type: "register", userId: userId(), repo: repoName(), files, index, team: teamId() };
      send(reg);
      log(`연결됨 · ${files.length}개 파일 등록 (인덱스 재사용)`);
    } catch (err) {
      log(`등록 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "impact") void handleImpact(msg);
      else if (msg.type === "presence") {
        peers = Array.isArray(msg.peers) ? msg.peers : [];
        updateStatus();
      }
    } catch {
      /* 무시 */
    }
  });

  ws.on("close", scheduleReconnect);
  ws.on("error", (err) => log(`연결 오류: ${err.message}`));
}

function scheduleReconnect(): void {
  connected = false;
  peers = [];
  updateStatus();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

/** affected pathHint 가 내 파일 중 하나를 가리키면 그 파일을 돌려준다. */
function matchMine(hint: string): string | undefined {
  const h = hint.toLowerCase().trim();
  if (h.length < 4) return undefined;
  for (const f of myFiles) {
    const fl = f.toLowerCase();
    if (fl === h || fl.endsWith(h) || h.endsWith(fl) || fl.includes(h) || h.includes(fl)) return f;
  }
  return undefined;
}

/** 영향받은 내 파일에서 바뀐 심볼이 실제로 쓰인 위치(file:line + 코드)를 찾는다. */
async function findUseSites(fullPath: string, symbols: string[]): Promise<UseSite[]> {
  const repo = repoName();
  const rel = fullPath.startsWith(`${repo}/`) ? fullPath.slice(repo.length + 1) : fullPath;
  if (/\.\.|[*?{}[\]]/.test(rel)) return [];
  const uris = await vscode.workspace.findFiles(rel, IGNORE_GLOB, 1);
  if (uris.length === 0) return [];
  try {
    const lines = Buffer.from(await vscode.workspace.fs.readFile(uris[0])).toString("utf8").split("\n");
    return locateUseSites(lines, symbols).map((s) => ({ rel, line: s.line, text: s.text }));
  } catch {
    return []; // 읽기 실패 무시
  }
}

async function handleImpact(msg: ImpactMessage): Promise<void> {
  const mine = msg.author === userId();
  let matched: string | undefined;
  if (!mine) {
    for (const a of msg.affected) {
      matched = matchMine(a.pathHint);
      if (matched) break;
    }
  }
  const hitsMe = Boolean(matched);
  // 내게 영향이면, 내 코드의 실제 사용 위치를 찾아 함께 보여준다 (어디서 어떻게 깨지나).
  const sites = hitsMe && matched ? await findUseSites(matched, msg.changedSymbols ?? []) : [];
  feed.push(msg, { mine, hitsMe, sites });

  // 접속 시 백필된 과거 변경은 피드에만 채우고 팝업·카운트는 건드리지 않는다 (노이즈 방지).
  if (msg.replay) return;

  if (hitsMe && !mine) {
    impactCount += 1;
    updateStatus();
  }
  if (!hitsMe) return;
  const reason = msg.affected.find((a) => matchMine(a.pathHint) === matched)?.reason ?? "";
  const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + "…" : s);
  const more = sites.length > 1 ? ` 외 ${sites.length - 1}곳` : "";
  const at = sites[0] ? ` @ ${sites[0].rel.split("/").pop()}:${sites[0].line}${more}` : "";
  // 어떻게 바뀌었나: 사람 말 요약(note)이 있으면 그걸, 없으면 before→after 원문.
  const d = (msg.changeDetails ?? [])[0];
  const how = d?.note
    ? `\n${d.symbol}: ${cut(d.note, 140)}`
    : d && d.before && d.after
      ? `\n${cut(d.before, 90)} → ${cut(d.after, 90)}`
      : "";
  // 서버발(發) 문자열은 길이 제한 — 과대 알림/스팸 방지.
  const text = `🌊 ${cut(msg.author, 40)} · ${cut(msg.repo, 30)}/${cut(msg.file, 80)} → 너의 ${cut(matched ?? "", 80)} 영향${at}: ${cut(reason, 120)}${how}`;
  // 팝업의 "열기" → 사용처 줄이 있으면 그 줄로, 없으면 파일로.
  const show = msg.severity === "high" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
  void show(text, "열기").then((pick) => {
    if (pick === "열기" && matched) void openByHint(sites[0]?.rel ?? matched, sites[0]?.line);
  });
}

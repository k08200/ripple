import * as os from "node:os";
import * as vscode from "vscode";
import { WebSocket } from "ws";
import { lineDiff } from "./diff";
import { FeedViewProvider } from "./feedView";
import { extractIndex } from "./indexer";
import type { ChangeMessage, FileIndex, ImpactMessage, IndexMessage, RegisterMessage } from "./protocol";

const CODE_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,java,rb,php,cs,kt,swift,rs,vue,svelte,sql,proto}";
const IGNORE_GLOB = "**/{node_modules,.git,dist,build,out,.next,vendor}/**";
const MAX_FILES = 3000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10_000;

let socket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = RECONNECT_BASE_MS;
let output: vscode.OutputChannel;
let feed: FeedViewProvider;
let status: vscode.StatusBarItem;
let connected = false;
let impactCount = 0;

/** 하단 상태바: 연결 상태 + 나에게 온 영향 건수를 한눈에. */
function updateStatus(): void {
  if (!status) return;
  if (connected) {
    status.text = `$(pulse) Ripple${impactCount > 0 ? ` · 영향 ${impactCount}` : ""}`;
    status.tooltip = "Ripple 연결됨 — 클릭하면 변경 피드";
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

function backendUrl(): string {
  return vscode.workspace.getConfiguration("ripple").get<string>("backendUrl") ?? "ws://localhost:7077";
}

function isTracked(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== "file" || doc.isUntitled) return false;
  const rel = vscode.workspace.asRelativePath(doc.uri, false);
  return !/(^|\/)(node_modules|\.git|dist|build|out|\.next|vendor)\//.test(rel);
}

export function activate(context: vscode.ExtensionContext): void {
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
    vscode.commands.registerCommand("ripple.reindex", async () => {
      indexed = false;
      indexMap.clear();
      myFiles.clear();
      await ensureIndexed();
      const { files, index } = registerPayload();
      send({ type: "register", userId: userId(), repo: repoName(), files, index });
      log("수동 재인덱싱");
    }),
  );

  connect();
  log(`Ripple 활성화 · user=${userId()} · repo=${repoName()}`);
}

export function deactivate(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.close();
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

function connect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.removeAllListeners();
  socket?.close();

  const url = backendUrl();
  const secret = vscode.workspace.getConfiguration("ripple").get<string>("secret")?.trim();
  log(`연결 시도: ${url}`);
  const ws = new WebSocket(url, secret ? { headers: { authorization: `Bearer ${secret}` } } : undefined);
  socket = ws;

  ws.on("open", async () => {
    reconnectDelay = RECONNECT_BASE_MS;
    connected = true;
    updateStatus();
    try {
      await ensureIndexed(); // 최초 1회만 스캔, 재연결 시 재사용
      const { files, index } = registerPayload();
      const reg: RegisterMessage = { type: "register", userId: userId(), repo: repoName(), files, index };
      send(reg);
      log(`연결됨 · ${files.length}개 파일 등록 (인덱스 재사용)`);
    } catch (err) {
      log(`등록 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ImpactMessage;
      if (msg.type === "impact") handleImpact(msg);
    } catch {
      /* 무시 */
    }
  });

  ws.on("close", scheduleReconnect);
  ws.on("error", (err) => log(`연결 오류: ${err.message}`));
}

function scheduleReconnect(): void {
  connected = false;
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

function handleImpact(msg: ImpactMessage): void {
  const mine = msg.author === userId();
  let matched: string | undefined;
  if (!mine) {
    for (const a of msg.affected) {
      matched = matchMine(a.pathHint);
      if (matched) break;
    }
  }
  const hitsMe = Boolean(matched);
  feed.push(msg, { mine, hitsMe });

  // 접속 시 백필된 과거 변경은 피드에만 채우고 팝업·카운트는 건드리지 않는다 (노이즈 방지).
  if (msg.replay) return;

  if (hitsMe && !mine) {
    impactCount += 1;
    updateStatus();
  }
  if (!hitsMe) return;
  const reason = msg.affected.find((a) => matchMine(a.pathHint) === matched)?.reason ?? "";
  const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + "…" : s);
  // 서버발(發) 문자열은 길이 제한 — 과대 알림/스팸 방지.
  const text = `🌊 ${cut(msg.author, 40)} · ${cut(msg.repo, 30)}/${cut(msg.file, 80)} → 너의 ${cut(matched ?? "", 80)} 영향: ${cut(reason, 120)}`;
  if (msg.severity === "high") void vscode.window.showWarningMessage(text);
  else void vscode.window.showInformationMessage(text);
}

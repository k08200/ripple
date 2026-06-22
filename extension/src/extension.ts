import * as os from "node:os";
import * as vscode from "vscode";
import { WebSocket } from "ws";
import { lineDiff } from "./diff";
import { FeedViewProvider } from "./feedView";
import { PreviewPanel } from "./previewPanel";
import { extractIndex } from "./indexer";
import type { ChangeMessage, FileIndex, ImpactMessage, RegisterMessage } from "./protocol";

const CODE_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,java,rb,php,cs,kt,swift,rs,vue,svelte,sql,proto}";
const IGNORE_GLOB = "**/{node_modules,.git,dist,build,out,.next,vendor}/**";
const MAX_FILES = 3000;
const RECONNECT_MAX_MS = 10_000;

let socket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = 1000;
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

function previewUrl(): string {
  return vscode.workspace.getConfiguration("ripple").get<string>("previewUrl") ?? "http://localhost:5173";
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
    vscode.commands.registerCommand("ripple.reconnect", () => {
      log("수동 재연결");
      connect();
    }),
    vscode.commands.registerCommand("ripple.openPreview", () => {
      PreviewPanel.createOrShow(previewUrl());
      log(`Live Preview 열기: ${previewUrl()}`);
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

function send(obj: ChangeMessage | RegisterMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj));
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
  myFiles.add(`${repo}/${rel}`);
  // 저장된 파일의 인덱스를 새로 떠서 함께 보낸다 → 백엔드 분석 후보가 세션 중에도 최신.
  send({ type: "change", userId: userId(), repo, file: rel, diff, index: extractIndex(rel, after) });
  log(`변경 전송: ${rel}`);
}

async function gatherWorkspace(): Promise<{ files: string[]; index: FileIndex[] }> {
  const uris = await vscode.workspace.findFiles(CODE_GLOB, IGNORE_GLOB, MAX_FILES);
  const repo = repoName();
  myFiles.clear();
  const files: string[] = [];
  const index: FileIndex[] = [];
  for (const u of uris) {
    const rel = vscode.workspace.asRelativePath(u, false);
    files.push(rel);
    myFiles.add(`${repo}/${rel}`);
    try {
      const bytes = await vscode.workspace.fs.readFile(u);
      index.push(extractIndex(rel, Buffer.from(bytes).toString("utf8")));
    } catch {
      /* 읽기 실패한 파일은 인덱스 생략 (경로는 유지). */
    }
  }
  return { files, index };
}

function connect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.removeAllListeners();
  socket?.close();

  const url = backendUrl();
  log(`연결 시도: ${url}`);
  const ws = new WebSocket(url);
  socket = ws;

  ws.on("open", async () => {
    reconnectDelay = 1000;
    connected = true;
    updateStatus();
    const { files, index } = await gatherWorkspace();
    const reg: RegisterMessage = { type: "register", userId: userId(), repo: repoName(), files, index };
    send(reg);
    log(`연결됨 · ${files.length}개 파일 등록 (${index.length} 인덱스)`);
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
  PreviewPanel.current?.push(msg, { mine, hitsMe });

  if (hitsMe && !mine) {
    impactCount += 1;
    updateStatus();
  }

  // 접속 시 백필된 과거 변경은 피드에만 채우고 팝업은 띄우지 않는다 (노이즈 방지).
  if (msg.replay) return;
  if (!hitsMe) return;
  const reason = msg.affected.find((a) => matchMine(a.pathHint) === matched)?.reason ?? "";
  const text = `🌊 ${msg.author} · ${msg.repo}/${msg.file} → 너의 ${matched} 영향: ${reason}`;
  if (msg.severity === "high") void vscode.window.showWarningMessage(text);
  else void vscode.window.showInformationMessage(text);
}

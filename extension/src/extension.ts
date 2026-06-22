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

  for (const doc of vscode.workspace.textDocuments) {
    if (isTracked(doc)) snapshots.set(doc.uri.fsPath, doc.getText());
  }

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider(FeedViewProvider.viewId, feed),
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
  send({ type: "change", userId: userId(), repo, file: rel, diff });
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

  if (!hitsMe) return;
  const reason = msg.affected.find((a) => matchMine(a.pathHint) === matched)?.reason ?? "";
  const text = `🌊 ${msg.author} · ${msg.repo}/${msg.file} → 너의 ${matched} 영향: ${reason}`;
  if (msg.severity === "high") void vscode.window.showWarningMessage(text);
  else void vscode.window.showInformationMessage(text);
}

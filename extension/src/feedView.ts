import * as vscode from "vscode";
import type { ImpactMessage } from "./protocol";

const MAX_FEED_ITEMS = 100;

/** 영향받은 내 파일에서 바뀐 심볼이 실제로 쓰인 위치. */
export interface UseSite {
  rel: string;
  line: number;
  text: string;
}

const IGNORE_GLOB = "**/{node_modules,.git,dist,build,out,.next,vendor}/**";

/** 영향 힌트(경로 또는 심볼)를 워크스페이스 파일로 해석해 연다. line 주면 그 줄로 점프. */
export async function openByHint(hint: string, line?: number): Promise<void> {
  // 힌트는 서버/LLM 발(發) 신뢰 불가 입력 — traversal·글로브 메타문자 차단.
  if (/\.\.|[*?{}[\]]/.test(hint)) return;
  const cleaned = hint.split(/[()]/)[0].trim(); // "loginUser()" → "loginUser"
  const rel = cleaned.replace(/^[^/]+\//, ""); // 앞 repo 세그먼트 제거 시도
  const base = cleaned.split("/").pop() ?? cleaned;
  let uris = rel.includes("/") ? await vscode.workspace.findFiles(`**/${rel}`, IGNORE_GLOB, 1) : [];
  if (uris.length === 0 && base.includes(".")) {
    uris = await vscode.workspace.findFiles(`**/${base}`, IGNORE_GLOB, 1);
  }
  if (uris.length === 0) {
    void vscode.window.showInformationMessage(`Ripple: '${hint}' 에 해당하는 파일을 못 찾음`);
    return;
  }
  // 워크스페이스 밖 경로는 열지 않는다 (이중 방어).
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root && !uris[0].fsPath.startsWith(root)) return;
  const editor = await vscode.window.showTextDocument(uris[0]);
  if (line && line > 0) {
    const pos = new vscode.Position(line - 1, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

/** 사이드바 "변경 피드" 웹뷰. 들어오는 영향 메시지를 시간순으로 쌓는다. */
export class FeedViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "ripple.feed";
  private view?: vscode.WebviewView;
  private readonly history: Array<ImpactMessage & { mine: boolean; hitsMe: boolean; sites?: UseSite[] }> = [];

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    // 피드 항목 클릭 → 그 파일(있으면 그 줄로) 열기.
    view.webview.onDidReceiveMessage((m: { type?: string; path?: string; line?: number }) => {
      if (m?.type === "open" && m.path) void openByHint(m.path, m.line);
    });
    // 새 뷰가 열리면 그동안 쌓인 히스토리를 다시 흘려보낸다.
    for (const item of this.history) view.webview.postMessage(item);
  }

  push(item: ImpactMessage, opts: { mine: boolean; hitsMe: boolean; sites?: UseSite[] }): void {
    // 재연결 백필이 이미 본 항목을 다시 쌓지 않게 id 로 중복 제거.
    if (this.history.some((h) => h.id === item.id)) return;
    const entry = { ...item, ...opts };
    this.history.push(entry);
    if (this.history.length > MAX_FEED_ITEMS) this.history.shift();
    this.view?.webview.postMessage(entry);
  }

  private html(): string {
    return /* html */ `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); margin: 0; padding: 8px; }
  .empty { color: var(--vscode-descriptionForeground); padding: 16px 4px; }
  .item { border-left: 3px solid #888; padding: 6px 8px; margin: 6px 0; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px; }
  .item.high { border-color: #e5534b; }
  .item.low  { border-color: #d29922; }
  .item.info { border-color: #3fb950; }
  .item.hit  { box-shadow: 0 0 0 1px var(--vscode-focusBorder); }
  .head { display: flex; gap: 6px; align-items: baseline; }
  .author { font-weight: 600; }
  .path { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); }
  .summary { margin: 4px 0 2px; }
  .aff { color: var(--vscode-descriptionForeground); margin-top: 2px; cursor: pointer; }
  .aff:hover b { text-decoration: underline; color: var(--vscode-textLink-foreground); }
  .aff b { color: var(--vscode-foreground); }
  .site { margin: 2px 0 2px 12px; padding: 2px 6px; border-left: 2px solid var(--vscode-textLink-foreground); cursor: pointer; font-family: var(--vscode-editor-font-family); font-size: 11px; background: var(--vscode-textBlockQuote-background); border-radius: 3px; }
  .site:hover { background: var(--vscode-editor-inactiveSelectionBackground); }
  .site .loc { color: var(--vscode-textLink-foreground); }
  .site code { color: var(--vscode-foreground); }
  .delta { margin: 3px 0 2px; font-family: var(--vscode-editor-font-family); font-size: 11px; }
  .delta .sym { font-weight: 600; }
  .delta .before { color: var(--vscode-gitDecoration-deletedResourceForeground, #e5534b); }
  .delta .after { color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950); }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .you { background: var(--vscode-focusBorder); color: #fff; }
</style></head>
<body>
  <div id="empty" class="empty">아직 변경 없음. 팀원이 파일을 저장하면 여기에 떠요.</div>
  <div id="list"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('list');
    const empty = document.getElementById('empty');
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    list.addEventListener('click', (e) => {
      const site = e.target.closest('.site');
      if (site && site.dataset.path) { vscode.postMessage({ type: 'open', path: site.dataset.path, line: Number(site.dataset.line) }); return; }
      const el = e.target.closest('.aff');
      if (el && el.dataset.path) vscode.postMessage({ type: 'open', path: el.dataset.path });
    });
    addEventListener('message', (e) => {
      const m = e.data;
      empty.style.display = 'none';
      const div = document.createElement('div');
      div.className = 'item ' + m.severity + (m.hitsMe ? ' hit' : '');
      const when = new Date(m.ts).toLocaleTimeString();
      const aff = (m.affected || []).map(a => '<div class="aff" title="클릭하면 열기" data-path="' + esc(a.pathHint) + '">↳ <b>' + esc(a.pathHint) + '</b> — ' + esc(a.reason) + '</div>').join('');
      // 어떻게 바뀌었나: 시그니처 before→after.
      const deltas = (m.changeDetails || []).map(d => {
        const b = d.before ? '<span class="before">- ' + esc(d.before) + '</span>' : '';
        const a = d.after ? '<span class="after">+ ' + esc(d.after) + '</span>' : '';
        return '<div class="delta"><span class="sym">' + esc(d.symbol) + '</span><br>' + b + (b && a ? '<br>' : '') + a + '</div>';
      }).join('');
      // 내게 영향이면, 내 코드의 실제 사용 위치(file:line + 코드)를 클릭 가능하게 보여준다.
      const sites = (m.sites || []).map(s => '<div class="site" title="이 줄로 점프" data-path="' + esc(s.rel) + '" data-line="' + s.line + '"><span class="loc">' + esc(s.rel.split('/').pop()) + ':' + s.line + '</span>  <code>' + esc(s.text) + '</code></div>').join('');
      div.innerHTML =
        '<div class="head">' +
          '<span class="author">' + esc(m.author) + (m.mine ? ' <span class="badge you">나</span>' : '') + '</span>' +
          (m.hitsMe ? '<span class="badge">너에게 영향</span>' : '') +
          '<span style="flex:1"></span><span class="path">' + when + '</span>' +
        '</div>' +
        '<div class="path">' + esc(m.repo) + '/' + esc(m.file) + '</div>' +
        '<div class="summary">' + esc(m.summary) + '</div>' + deltas + aff + sites;
      list.prepend(div);
    });
  </script>
</body></html>`;
  }
}

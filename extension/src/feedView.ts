import * as vscode from "vscode";
import type { ImpactMessage } from "./protocol";

const MAX_FEED_ITEMS = 100;

/** 사이드바 "변경 피드" 웹뷰. 들어오는 영향 메시지를 시간순으로 쌓는다. */
export class FeedViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "ripple.feed";
  private view?: vscode.WebviewView;
  private readonly history: Array<ImpactMessage & { mine: boolean; hitsMe: boolean }> = [];

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    // 새 뷰가 열리면 그동안 쌓인 히스토리를 다시 흘려보낸다.
    for (const item of this.history) view.webview.postMessage(item);
  }

  push(item: ImpactMessage, opts: { mine: boolean; hitsMe: boolean }): void {
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
  .aff { color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .aff b { color: var(--vscode-foreground); }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .you { background: var(--vscode-focusBorder); color: #fff; }
</style></head>
<body>
  <div id="empty" class="empty">아직 변경 없음. 팀원이 파일을 저장하면 여기에 떠요.</div>
  <div id="list"></div>
  <script>
    const list = document.getElementById('list');
    const empty = document.getElementById('empty');
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    addEventListener('message', (e) => {
      const m = e.data;
      empty.style.display = 'none';
      const div = document.createElement('div');
      div.className = 'item ' + m.severity + (m.hitsMe ? ' hit' : '');
      const when = new Date(m.ts).toLocaleTimeString();
      const aff = (m.affected || []).map(a => '<div class="aff">↳ <b>' + esc(a.pathHint) + '</b> — ' + esc(a.reason) + '</div>').join('');
      div.innerHTML =
        '<div class="head">' +
          '<span class="author">' + esc(m.author) + (m.mine ? ' <span class="badge you">나</span>' : '') + '</span>' +
          (m.hitsMe ? '<span class="badge">너에게 영향</span>' : '') +
          '<span style="flex:1"></span><span class="path">' + when + '</span>' +
        '</div>' +
        '<div class="path">' + esc(m.repo) + '/' + esc(m.file) + '</div>' +
        '<div class="summary">' + esc(m.summary) + '</div>' + aff;
      list.prepend(div);
    });
  </script>
</body></html>`;
  }
}

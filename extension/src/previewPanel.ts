import * as vscode from "vscode";
import type { ImpactMessage } from "./protocol";

/**
 * Live Preview 패널 — 실제 돌아가는 프론트 앱(previewUrl)을 에디터 옆에 iframe 으로 띄우고,
 * 하단 티커에 들어오는 변경/영향을 라이브로 흘린다.
 * "코드 저장 → 화면 바뀜(HMR) → AI 영향" 이 한 화면에서 보이게 하는 조각.
 */
export class PreviewPanel {
  public static current: PreviewPanel | undefined;
  private static readonly viewType = "ripple.preview";

  private readonly panel: vscode.WebviewPanel;
  private disposed = false;

  static createOrShow(url: string): void {
    const column = vscode.ViewColumn.Beside;
    if (PreviewPanel.current) {
      PreviewPanel.current.panel.reveal(column);
      PreviewPanel.current.panel.webview.html = PreviewPanel.current.html(url);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      "🌊 Ripple Live Preview",
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    PreviewPanel.current = new PreviewPanel(panel, url);
  }

  private constructor(panel: vscode.WebviewPanel, url: string) {
    this.panel = panel;
    this.panel.webview.html = this.html(url);
    this.panel.onDidDispose(() => this.dispose());
    // webview 가 localhost iframe 을 못 물 때를 대비: 외부 브라우저로 열기.
    this.panel.webview.onDidReceiveMessage((m) => {
      if (m?.cmd === "open" && typeof m.url === "string") {
        void vscode.env.openExternal(vscode.Uri.parse(m.url));
      }
    });
  }

  push(item: ImpactMessage, opts: { mine: boolean; hitsMe: boolean }): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage({ ...item, ...opts });
  }

  private dispose(): void {
    this.disposed = true;
    PreviewPanel.current = undefined;
    this.panel.dispose();
  }

  private html(url: string): string {
    const safeUrl = url.replace(/"/g, "");
    return /* html */ `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; frame-src ${safeUrl} http://localhost:* https://localhost:* http://127.0.0.1:*; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  html, body { height: 100%; margin: 0; background: #0f1115; color: #e6e9ef; font-family: var(--vscode-font-family); }
  .wrap { display: flex; flex-direction: column; height: 100vh; }
  .bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #12151b; border-bottom: 1px solid #262b35; font-size: 12px; }
  .bar .url { color: #8b93a3; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar button { background: #262b35; color: #e6e9ef; border: 0; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .bar button:hover { background: #2f3645; }
  .framebox { flex: 1; position: relative; }
  iframe { width: 100%; height: 100%; border: 0; background: #fff; }
  .ticker {
    flex: 0 0 auto; max-height: 38%; overflow-y: auto;
    border-top: 1px solid #262b35; background: #12151b; padding: 8px 12px;
  }
  .ticker h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #8b93a3; margin: 0 0 6px; }
  .empty { color: #8b93a3; font-size: 12px; padding: 4px 0; }
  .item { font-size: 12px; padding: 6px 8px; margin: 4px 0; border-left: 3px solid #3fb950; background: #181b22; border-radius: 4px; }
  .item.high { border-color: #e5534b; }
  .item.low { border-color: #d29922; }
  .item.hit { box-shadow: 0 0 0 1px #3b82f6; }
  .item .meta { color: #8b93a3; }
  .item.flash { animation: flash .8s ease-out; }
  @keyframes flash { from { background: #1f3b2a; } to { background: #181b22; } }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 8px; background: #3b82f6; color: #fff; }
</style></head>
<body>
  <div class="wrap">
    <div class="bar">
      <span class="url">🌊 ${safeUrl}</span>
      <button id="reload">↻ 새로고침</button>
      <button id="open">브라우저에서 열기</button>
    </div>
    <div class="framebox"><iframe id="frame" src="${safeUrl}" title="live preview"></iframe></div>
    <div class="ticker">
      <h2>🌊 Live 변경 · 영향</h2>
      <div id="empty" class="empty">저장하면 위 화면이 바뀌고, 변경 영향이 여기 흐릅니다. (preview: ${safeUrl})</div>
      <div id="list"></div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('list');
    const empty = document.getElementById('empty');
    const frame = document.getElementById('frame');
    document.getElementById('open').addEventListener('click', () => vscode.postMessage({ cmd: 'open', url: "${safeUrl}" }));
    document.getElementById('reload').addEventListener('click', () => { frame.src = frame.src; });
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    addEventListener('message', (e) => {
      const m = e.data; if (!m || m.type !== 'impact') return;
      empty.style.display = 'none';
      const div = document.createElement('div');
      div.className = 'item flash ' + m.severity + (m.hitsMe ? ' hit' : '');
      const when = new Date(m.ts).toLocaleTimeString();
      div.innerHTML =
        '<div><b>' + esc(m.author) + '</b> · ' + esc(m.repo) + '/' + esc(m.file) +
        (m.hitsMe ? ' <span class="badge">너에게 영향</span>' : '') + '</div>' +
        '<div>' + esc(m.summary) + '</div>' +
        '<div class="meta">' + when + '</div>';
      list.prepend(div);
      while (list.children.length > 30) list.removeChild(list.lastChild);
    });
  </script>
</body></html>`;
  }
}

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
    view.webview.onDidReceiveMessage(
      (m: { type?: string; path?: string; line?: number; url?: string; id?: string; ids?: string[] }) => {
        // 웹뷰 스크립트가 준비됐다고 알리면 그제서야 history 를 보낸다(race 방지).
        if (m?.type === "ready") {
          for (const item of this.history) view.webview.postMessage(item);
          return;
        }
        // PR 뱃지 클릭 → 브라우저로 PR 열기.
        if (m?.type === "openUrl" && m.url) {
          void vscode.env.openExternal(vscode.Uri.parse(m.url));
          return;
        }
        // 피드 항목 클릭 → 그 파일(있으면 그 줄로) 열기.
        if (m?.type === "open" && m.path) {
          void openByHint(m.path, m.line);
          return;
        }
        // 삭제 — 웹뷰가 DOM 은 직접 지우고, 여기선 history 에서 빼 재오픈해도 안 돌아오게 한다.
        if (m?.type === "delete" && m.id) {
          this.removeIds([m.id]);
          return;
        }
        if (m?.type === "deleteMany" && Array.isArray(m.ids)) {
          this.removeIds(m.ids);
          return;
        }
        if (m?.type === "clear") {
          this.history.length = 0;
        }
      },
    );
  }

  /** history 에서 주어진 id 들을 제거 (제자리 변형 — 재오픈 시 안 보이게). */
  private removeIds(ids: string[]): void {
    const drop = new Set(ids);
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (drop.has(this.history[i].id)) this.history.splice(i, 1);
    }
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
  .delta .note { color: var(--vscode-charts-yellow, #d29922); margin-left: 6px; font-weight: 500; }
  .delta .before { color: var(--vscode-gitDecoration-deletedResourceForeground, #e5534b); }
  .delta .after { color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950); }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .you { background: var(--vscode-focusBorder); color: #fff; }
  .pr { background: #8957e5; color: #fff; cursor: pointer; }
  .pr:hover { filter: brightness(1.15); }
  .commit { background: #2ea043; color: #fff; }
  .push { background: #db6d28; color: #fff; }
  .save { background: #1f6feb; color: #fff; }
  .risk-high { background: #da3633; color: #fff; font-weight: 600; }
  .risk-low { background: #9e6a03; color: #fff; }
  .risk-info { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); opacity: .8; }
  .hitme { background: var(--vscode-focusBorder); color: #fff; }
  #toolbar { display: none; gap: 6px; align-items: center; padding: 2px 2px 8px; margin-bottom: 4px; position: sticky; top: 0; z-index: 2; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); border-bottom: 1px solid var(--vscode-panel-border); }
  #toolbar button { font-size: 11px; padding: 2px 8px; cursor: pointer; border: none; border-radius: 3px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  #clearBtn { color: var(--vscode-errorForeground); }
  .del { margin-left: 6px; cursor: pointer; color: var(--vscode-descriptionForeground); padding: 0 4px; border-radius: 3px; font-weight: 700; }
  .del:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-errorForeground); }
  .sel-cb { display: none; margin-right: 2px; vertical-align: middle; }
  body.selecting .sel-cb { display: inline-block; }
  body.selecting .del { display: none; }
  body.selecting .item { cursor: pointer; }
</style></head>
<body>
  <div id="toolbar">
    <button id="selectBtn" title="여러 개 골라 삭제">선택</button>
    <button id="clearBtn" title="피드 전체 삭제">전체 삭제</button>
    <span id="selActions" style="display:none">
      <button id="delSelBtn">선택 삭제 (0)</button>
      <button id="cancelBtn">취소</button>
    </span>
  </div>
  <div id="empty" class="empty">아직 변경 없음. 팀원이 파일을 저장하면 여기에 떠요.</div>
  <div id="list"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('list');
    const empty = document.getElementById('empty');
    const toolbar = document.getElementById('toolbar');
    const selectBtn = document.getElementById('selectBtn');
    const clearBtn = document.getElementById('clearBtn');
    const selActions = document.getElementById('selActions');
    const delSelBtn = document.getElementById('delSelBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

    let selecting = false;
    const checks = () => [...list.querySelectorAll('.sel-cb')];
    function refresh() {
      const has = list.children.length > 0;
      toolbar.style.display = has ? 'flex' : 'none';
      empty.style.display = has ? 'none' : 'block';
      if (!has && selecting) exitSelect();
    }
    function updateCount() { delSelBtn.textContent = '선택 삭제 (' + checks().filter(c => c.checked).length + ')'; }
    function enterSelect() { selecting = true; document.body.classList.add('selecting'); selActions.style.display = 'inline'; selectBtn.style.display = 'none'; clearBtn.style.display = 'none'; updateCount(); }
    function exitSelect() { selecting = false; document.body.classList.remove('selecting'); selActions.style.display = 'none'; selectBtn.style.display = ''; clearBtn.style.display = ''; checks().forEach(c => c.checked = false); }
    selectBtn.onclick = enterSelect;
    cancelBtn.onclick = exitSelect;
    clearBtn.onclick = () => { list.innerHTML = ''; vscode.postMessage({ type: 'clear' }); refresh(); };
    delSelBtn.onclick = () => {
      const ids = [];
      [...list.querySelectorAll('.item')].forEach(it => {
        const cb = it.querySelector('.sel-cb');
        if (cb && cb.checked) { ids.push(it.dataset.id); it.remove(); }
      });
      if (ids.length) vscode.postMessage({ type: 'deleteMany', ids });
      exitSelect();
      refresh();
    };

    list.addEventListener('change', (e) => { if (e.target.classList.contains('sel-cb')) updateCount(); });
    list.addEventListener('click', (e) => {
      // 한개씩 삭제 — 시간 옆 × 버튼.
      const del = e.target.closest('.del');
      if (del) { const it = del.closest('.item'); if (it) { vscode.postMessage({ type: 'delete', id: it.dataset.id }); it.remove(); refresh(); } return; }
      // 선택 모드에선 항목 클릭 = 체크 토글 (체크박스 직접 클릭 제외).
      if (selecting && !e.target.classList.contains('sel-cb')) {
        const it = e.target.closest('.item');
        const cb = it && it.querySelector('.sel-cb');
        if (cb) { cb.checked = !cb.checked; updateCount(); }
        return;
      }
      const pr = e.target.closest('.pr');
      if (pr && pr.dataset.url) { vscode.postMessage({ type: 'openUrl', url: pr.dataset.url }); return; }
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
      div.dataset.id = m.id;
      const when = new Date(m.ts).toLocaleTimeString();
      const aff = (m.affected || []).map(a => '<div class="aff" title="클릭하면 열기" data-path="' + esc(a.pathHint) + '">↳ <b>' + esc(a.pathHint) + '</b> — ' + esc(a.reason) + '</div>').join('');
      // 어떻게 바뀌었나: 시그니처 before→after.
      const deltas = (m.changeDetails || []).map(d => {
        const b = d.before ? '<span class="before">- ' + esc(d.before) + '</span>' : '';
        const a = d.after ? '<span class="after">+ ' + esc(d.after) + '</span>' : '';
        const note = d.note ? '<span class="note">' + esc(d.note) + '</span>' : '';
        return '<div class="delta"><span class="sym">' + esc(d.symbol) + '</span>' + note + '<br>' + b + (b && a ? '<br>' : '') + a + '</div>';
      }).join('');
      // 내게 영향이면, 내 코드의 실제 사용 위치(file:line + 코드)를 클릭 가능하게 보여준다.
      const sites = (m.sites || []).map(s => '<div class="site" title="이 줄로 점프" data-path="' + esc(s.rel) + '" data-line="' + s.line + '"><span class="loc">' + esc(s.rel.split('/').pop()) + ':' + s.line + '</span>  <code>' + esc(s.text) + '</code></div>').join('');
      // 출처 뱃지 — PR(보라, 클릭=PR 열기) / 커밋(초록) / 푸시(주황) / 저장(파랑, 기본이라 생략).
      let srcBadge = '';
      if (m.source === 'pr' && m.pr) {
        srcBadge = '<span class="badge pr" data-url="' + esc(m.pr.url) + '" title="' + esc(m.pr.title) + ' — 클릭하면 PR 열기">PR #' + m.pr.number + '</span>';
      } else if (m.source === 'commit' && m.commit) {
        srcBadge = '<span class="badge commit" title="' + esc(m.commit.subject || '') + '">커밋 ' + esc((m.commit.sha || '').slice(0, 7)) + '</span>';
      } else if (m.source === 'push' && m.commit) {
        srcBadge = '<span class="badge push" title="' + esc(m.commit.ref || '') + ' 로 푸시">푸시 ' + esc((m.commit.sha || '').slice(0, 7)) + '</span>';
      }
      // 위험도 — high=계약 깨짐(부서질 수 있음), low=추가, info=참고. 영향 파일 수(blast)도 함께.
      const blast = (m.affected || []).length;
      const riskMap = { high: ['risk-high', '🔴 높음'], low: ['risk-low', '🟡 주의'], info: ['risk-info', '⚪ 참고'] };
      const rk = riskMap[m.severity] || riskMap.info;
      const riskBadge = '<span class="badge ' + rk[0] + '" title="위험도: ' + (m.severity === 'high' ? '계약 변경 — 호출부가 부서질 수 있음' : m.severity === 'low' ? '추가 변경 — 기존 코드엔 안전' : '내부 변경 — 영향 없음') + '">' + rk[1] + (blast > 0 ? ' · ' + blast + '곳' : '') + '</span>';
      div.innerHTML =
        '<div class="head">' +
          '<input type="checkbox" class="sel-cb" title="선택" />' +
          riskBadge +
          '<span class="author">' + esc(m.author) + (m.mine ? ' <span class="badge you">나</span>' : '') + '</span>' +
          srcBadge +
          (m.hitsMe ? '<span class="badge hitme">너에게 영향</span>' : '') +
          '<span style="flex:1"></span><span class="path">' + when + '</span>' +
          '<span class="del" title="이 항목 삭제">×</span>' +
        '</div>' +
        '<div class="path">' + esc(m.repo) + '/' + esc(m.file) + '</div>' +
        '<div class="summary">' + esc(m.summary) + '</div>' + deltas + aff + sites;
      list.prepend(div);
      refresh();
    });
    // 스크립트 준비 완료 → 확장에 history 재전송 요청 (나중에 열어도 과거 항목이 뜬다).
    vscode.postMessage({ type: 'ready' });
  </script>
</body></html>`;
  }
}

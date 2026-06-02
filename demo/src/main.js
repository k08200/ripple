import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { MonacoBinding } from 'y-monaco'

// --- Monaco 워커 설정 (Vite) ---
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

// --- 에디터 ---
const editor = monaco.editor.create(document.getElementById('editor'), {
  value: '// 여기 타이핑하면 다른 탭에 라이브로 똑같이 떠요.\n// Ripple 0단계: Monaco + Yjs(CRDT) 동시 편집.\n\nfunction hello() {\n  console.log("ripple")\n}\n',
  language: 'javascript',
  theme: 'vs-dark',
  automaticLayout: true,
  fontSize: 14,
  minimap: { enabled: false },
})

// --- Yjs 라이브 동기화 ---
// 같은 room 이름을 가진 모든 탭/피어가 같은 문서를 공유.
// 같은 브라우저의 다른 탭은 BroadcastChannel로, 다른 기기는 WebRTC로 동기화.
const ydoc = new Y.Doc()
const provider = new WebrtcProvider('ripple-demo-room', ydoc, {
  signaling: [
    'wss://signaling.yjs.dev',
    'wss://y-webrtc-signaling-eu.herokuapp.com',
  ],
})
const ytext = ydoc.getText('monaco')

// Monaco <-> Yjs 바인딩 (이 한 줄이 라이브 협업의 핵심)
new MonacoBinding(ytext, editor.getModel(), new Set([editor]), provider.awareness)

// --- 연결 상태 표시 ---
const statusEl = document.getElementById('status')
const statusText = document.getElementById('status-text')

function render() {
  const peers = provider.awareness.getStates().size // 자신 포함
  const others = Math.max(0, peers - 1)
  statusEl.classList.toggle('connected', provider.connected)
  statusText.textContent = provider.connected
    ? `연결됨 · 함께 보는 사람 ${others}명`
    : '연결 중…'
}

provider.on('status', render)
provider.awareness.on('change', render)
render()

# 🌊 Ripple — 0단계 데모

Monaco + Yjs(CRDT)로 **두 탭에서 같은 코드가 라이브로 동시 편집**되는 최소 데모.
"라이브 협업, 진짜 된다"를 눈으로 확인하는 게 목적.

## 실행

```bash
cd ~/Downloads/ripple-demo
npm install
npm run dev
```

→ 브라우저에서 열리는 주소(보통 http://localhost:5173)를 **두 개의 탭/창**으로 엽니다.
한쪽에서 타이핑하면 다른 쪽에 즉시 똑같이 떠요.

## 구조 (핵심만)

- `monaco-editor` — VS Code 편집 엔진
- `yjs` + `y-webrtc` — 라이브 동기화 (같은 브라우저 탭은 BroadcastChannel, 다른 기기는 WebRTC)
- `y-monaco` — Monaco ↔ Yjs 바인딩 (`src/main.js`의 `new MonacoBinding(...)` 한 줄이 협업의 핵심)

## 다음 단계 (1단계)

변경 diff → AI가 "이 변경 누구한테 영향 가는지" 한 줄 분석 붙이기.

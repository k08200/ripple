# 🌊 Ripple — Live Change Impact (VS Code Extension)

저장할 때마다 AI가 변경 영향을 읽어 **영향받는 팀원에게 찔러주는** 익스텐션. (any-to-any)

- **저장 감지** → diff 를 Ripple 백엔드로 전송
- **AI 영향 분석** → "이 변경 너에게 영향 감" 알림
- **Live Preview 패널** → 실제 프론트 화면 + 변경 티커를 한 화면에
- **변경 피드 사이드바** → 전사 변경이 실시간으로 흐름

## 설정

| 키 | 기본값 | 설명 |
|---|---|---|
| `ripple.backendUrl` | `ws://localhost:7077` | 백엔드 WebSocket URL |
| `ripple.previewUrl` | `http://localhost:5173` | Live Preview 가 띄울 실제 프론트 앱 URL |
| `ripple.userId` | (OS 사용자명) | 팀에서 나를 식별하는 이름 |

## 명령

- `Ripple: Live Preview 열기`
- `Ripple: 백엔드 재연결`

> Cursor · Windsurf 에서도 그대로 동작합니다 (동일 확장 API).

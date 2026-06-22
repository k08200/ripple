<div align="center">

# 🌊 Ripple

### 라이브 변경 영향 분석 — 저장하면, AI가 영향받는 팀원에게 찔러준다

**각자 쓰던 VS Code에 익스텐션 하나 깔면, 파일을 저장할 때마다 AI가 그 변경이 누구한테 영향 가는지 읽어서 영향받는 팀원에게 알려줍니다. (any-to-any)**

</div>

---

## 한 줄

> 백엔드가 저장하면 → 영향받는 프론트가 본다.
> 백엔드 → 백엔드도, 프론트 → 프론트도 마찬가지.
> **역할로 라우팅하지 않는다. 코드 의존(시그니처·스키마·export·라우트)으로 라우팅한다.**

Git은 커밋된 스냅샷만 본다. Ripple은 **저장하는 순간**을 잡아서 라이브로 흘린다.

---

## 구조 — 두뇌는 백엔드, 에디터는 얇은 클라이언트

```
   ┌─ VS Code 익스텐션 ──┐   ← Cursor · Windsurf 자동 포함 (같은 확장 API)
   │  · onDidSaveTextDocument 로 저장 감지
   │  · diff 를 백엔드로 전송
   │  · "너에게 영향" 알림 + 사이드바 변경 피드
   └──────────┬──────────┘
              │  WebSocket
              ▼
   ┌──────────────────────────────────┐
   │      백엔드 (진짜 두뇌)             │
   │  · 모든 사람의 변경 수집            │
   │  · AI 가 diff 읽고 영향 분석        │
   │  · 영향받는 사람에게 라우팅·브로드캐스트 │
   └──────────────────────────────────┘
```

에디터 추가 = 두뇌 다시 짜기가 아니라 **얇은 어댑터 하나 붙이기.** (JetBrains/Zed 는 나중에 어댑터만)

---

## 폴더

| 경로 | 내용 |
|---|---|
| [`backend/`](backend/) | 두뇌. WebSocket 서버 + AI 영향 분석. provider 교체식 (Claude / mock) |
| [`extension/`](extension/) | VS Code 익스텐션. 저장 감지 → diff 전송 → 알림 + 피드 |
| [`demo/`](demo/) | 0단계 Monaco+Yjs 라이브 협업 데모 (라이브 가능성 증명용, 제품엔 미포함) |

---

## 실행

> 🚀 **실제로 어떻게 쓰는지(설치 → 데모 → VS Code → 팀 배포 → 트러블슈팅)는 [USAGE.md](USAGE.md) 참고.** 아래는 요약.

### 1. 백엔드 두뇌 띄우기

```bash
cd backend
npm install        # (루트에서 한 번 npm install 했으면 생략)
npm run dev        # ws://localhost:7077

# AI 분석을 진짜 Claude 로 하려면:
ANTHROPIC_API_KEY=sk-... npm run dev
# 키 없으면 휴리스틱 mock 으로 자동 동작 (구조 검증용)
```

상태 확인: `curl http://localhost:7077/health` → `{"ok":true,"provider":"claude|mock",...}`

### 2. 익스텐션 띄우기

```bash
cd extension
npm install        # (루트에서 했으면 생략)
npm run build
# VS Code 로 extension/ 폴더 열고 F5 (Run Ripple Extension)
```

→ 새 VS Code 창이 뜸. 두 사람(또는 두 창)이 각자 다른 repo 를 열고 같은 백엔드(`ripple.backendUrl`)에 붙으면,
한쪽이 파일 저장 → 다른 쪽에 **"🌊 너에게 영향"** 알림 + 사이드바 피드에 변경이 흐름.

### 설정 (VS Code Settings)

| 키 | 기본값 | 설명 |
|---|---|---|
| `ripple.backendUrl` | `ws://localhost:7077` | 백엔드 WebSocket URL |
| `ripple.userId` | (OS 사용자명) | 팀에서 나를 식별하는 이름 |

---

## 동작 검증 (E2E)

`mock` 프로바이더로 "백엔드 저장 → 프론트 알림"이 실제로 도는지 확인됨:

```
Alice(payment-api) 가 payment.ts 의 export 시그니처 변경 저장
  → severity: high (계약 변경)
  → Bob(web)의 payment-client.ts 가 영향 대상으로 잡힘
  → Bob 에게 impact 푸시  ✅
```

---

## AI 프로바이더 (클코 vs 코덱스 — 교체식)

[`backend/src/providers/provider.ts`](backend/src/providers/provider.ts) 의 `Provider` 인터페이스만 구현하면 분석 엔진을 갈아끼울 수 있음.

- ✅ `ClaudeProvider` — Anthropic Messages API (`claude-sonnet-4-6`, SDK 없이 fetch)
- ✅ `MockProvider` — 키 없이 도는 휴리스틱 fallback
- ⬜ `CodexProvider` — 동일 인터페이스로 추가하면 끝

---

## 로드맵

| 단계 | 내용 | 상태 |
|:--:|---|:--:|
| 0 | Monaco + Yjs 라이브 협업 데모 ("라이브 진짜 됨") | ✅ `demo/` |
| 1 | 저장 → diff → 영향 분석 → 영향자 알림 (MVP 동작) | ✅ |
| **2** | **결정론적 의존 그래프 엔진 + 측정 하네스** | ✅ **여기 (실측: R100/P~78, LLM보다 정확)** |
| 3 | 실제 팀 dogfooding (이제 임계 검증됐으니) | ⬜ |
| 4 | 어댑터 확장(JetBrains/Zed) · 전사 repo | ⬜ |

> **핵심 발견**: "AI가 코드를 읽어 영향을 알려준다"의 엔진은 LLM이 아니라 **결정론적 의존 그래프**였다.
> 실측(`scripts/eval.mjs`, autobe 실제 커밋)에서 graph R100/P~78 > LLM 4구성 전부. 자세한 건 [`scripts/README.md`](scripts/README.md).

---

## 설계 원칙 (스코프 독)

- ❌ VS Code 바닥부터 → Monaco/익스텐션 위에
- ❌ 키 입력 실시간 집착 → **파일 저장 단위** (반쯤 쓴 코드는 노이즈)
- ❌ 처음부터 전 에디터·전사 repo → VS Code 패밀리 + 한 팀 2–3 repo
- ❌ 채팅 직접 구현 → AI 대화가 그 자리를 대체

> **차별점은 에디터가 아니라 "AI가 코드 변경을 사람 대신 읽고 영향을 알려주는 것." 에디터는 그릇.**

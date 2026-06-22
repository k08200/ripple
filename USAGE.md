# Ripple 사용법 — 실제로 쓰는 법

저장하면 → AI(결정론적 의존 그래프)가 그 변경이 누구한테 영향 가는지 읽어서 → 영향받는 팀원에게 찔러준다.
아래는 **검증된 순서**다. 0→1→2 순으로 따라가면 된다.

---

## 0. 설치 & 빌드 (한 번)

```bash
git clone https://github.com/k08200/ripple.git
cd ripple
npm install
npm run build      # backend + extension 둘 다 컴파일
npm test           # 21/21 통과 확인 (엔진·diff·indexer·파이프라인)
```

---

## 1. 5분 데모 — VS Code 없이 "진짜 도는지" 보기

두뇌(백엔드)를 띄우고, 가짜 팀원 3명으로 저장→영향 알림 흐름을 본다.

```bash
# 터미널 A — 두뇌
npm run brain
#   🌊 ws://localhost:7077 · provider=graph   (키 불필요, 결정론)

# 터미널 B — E2E 시뮬레이터
npm run sim
```

보게 되는 것:
```
alice 가 src/payment.ts 의 charge() 시그니처 변경 저장
  bob 이 영향 알림 받음:        ✅ (web/src/payment-client.ts)
  carol 은 영향 없음:           ✅
  db.ts 오탐 사라짐(graph):     ✅
```
→ 배선이 실제로 돈다는 증거. (엔진 정확도 숫자는 `npm run eval` / [scripts/README.md](scripts/README.md))

---

## 2. 진짜로 쓰기 — VS Code 익스텐션

### 2a. 개발 모드로 띄우기 (가장 빠름)

```bash
code extension/        # extension 폴더를 VS Code 로 열고
# F5 (Run Ripple Extension) → "확장 개발 호스트" 새 창이 뜸
```
새 창에서 아무 코드 repo 나 열면, Ripple 이 자동 활성화되어 백엔드에 붙는다.
좌측 액티비티바의 🌊 Ripple → "변경 피드" 가 보인다.

### 2b. 설치해서 상시 쓰기 (.vsix)

```bash
npm run package        # extension/ripple.vsix 생성
code --install-extension extension/ripple.vsix
# 또는 VS Code: Extensions → ··· → Install from VSIX
```
Cursor / Windsurf 도 같은 확장 API라 동일하게 설치된다.

### 설정 (VS Code Settings, `ripple.` 검색)

| 키 | 기본값 | 설명 |
|---|---|---|
| `ripple.backendUrl` | `ws://localhost:7077` | 두뇌 WebSocket 주소 |
| `ripple.userId` | (OS 사용자명) | 팀에서 나를 식별하는 이름 |

---

## 3. 팀으로 쓰기

두뇌 하나를 팀이 닿는 곳에 띄우고, 각자 `ripple.backendUrl` 을 거기로 맞춘다.

```bash
# 공용 호스트(사내 서버 등)에서
PORT=7077 npm run brain
#   상태 확인: curl http://<host>:7077/health  → {"ok":true,"provider":"graph",...}
```

각 팀원: `ripple.backendUrl = ws://<host>:7077`, `ripple.userId = 본인이름`.
이제 **누가 저장하든**, 그 변경이 import/심볼 의존으로 닿는 파일을 가진 사람에게만 알림이 간다.
역할(프론트/백) 무관 — 코드 의존으로만 라우팅한다 (any-to-any).

---

## 4. 무슨 일이 실제로 일어나나 (흐름)

```
파일 저장 (onDidSaveTextDocument)
  → 익스텐션: 저장 전/후 lineDiff 계산 + 워크스페이스 심볼 인덱스(exports/imports/refs)
  → WebSocket 으로 두뇌에 전송
  → 두뇌: graph 엔진이 diff 의 바뀐 심볼/라우트/필드를 뽑아
           팀 전체 인덱스에서 그걸 import/참조하는 파일을 의존 엣지로 판정
  → 영향받는 파일을 가진 사람에게 "🌊 너에게 영향" 알림 + 사이드바 피드
```

severity: `high`(계약/시그니처/스키마 제거·변경) · `low`(추가) · `info`(내부 구현 — 아무도 안 찌름).

---

## 5. 분석 엔진 고르기

기본은 **graph**(결정론·무료·실측이 제일 정확). 바꾸려면 환경변수:

```bash
RIPPLE_PROVIDER=graph     npm run brain   # 기본. 키 불필요
RIPPLE_PROVIDER=hybrid    OPENROUTER_API_KEY=... npm run brain   # additive 에만 LLM 보조(opt-in)
ANTHROPIC_API_KEY=...     npm run brain   # 강제 안 하면 graph 가 이김(실측). 보통 불필요
```

> 왜 기본이 graph 인가: 실제 3개 repo 측정에서 graph(R100/P78~97) > LLM 4구성 전부.
> 자세한 근거는 [scripts/README.md](scripts/README.md).

---

## 6. 한계 (정직하게)

- **두뇌는 in-memory · 무인증 · 전체 broadcast** — 변경 요약이 접속한 모두에게 흐른다. **한 팀(신뢰 그룹) 규모용**. 전사/외부 노출 전엔 인증·라우팅 격리 필요.
- precision 78~97%(코드베이스별), recall 100%. 즉 **거의 안 놓치되 가끔 "import 는 하지만 그 심볼은 안 쓰는" 파일을 같이 짚는다**. 알림 제품엔 놓치는 것보다 나은 트레이드.
- `info`(내부 구현 변경)는 의도적으로 안 찌른다 — 노이즈 억제.

---

## 7. 문제 해결

| 증상 | 확인 |
|---|---|
| 알림이 안 옴 | `curl http://localhost:7077/health` 로 두뇌 살았는지 · `ripple.backendUrl` 일치 · VS Code "Ripple" 출력 채널 로그 |
| 연결 안 됨 | 두뇌 먼저 띄웠는지, 포트(7077) 방화벽 |
| 영향이 과하게 잡힘 | 정상 동작 범위(precision 78~97%). `info`/`low`/`high` 로 우선순위 구분됨 |

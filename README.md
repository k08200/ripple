<div align="center">

# 🌊 Ripple

### 라이브 변경 영향 분석 — 코드가 바뀌면, *네 코드의 어디가 어떻게 깨지는지* 자동으로 알려준다

**같은 팀에 익스텐션 하나씩 깔면 끝.** 누가 함수·타입·스키마를 바꾸면, 그걸 쓰는 사람에게
**"너의 payment-client.ts:42 가 이렇게 깨진다"** 가 저장 순간(라이브) + PR 시점(게이트)에 뜬다.

</div>

---

## 핵심 — 무엇이·어떻게·어디서·얼마나

```
🌊 alice · payment-api/src/payment.ts → 너의 payment-client.ts:42 외 2곳 영향
   charge: currency 인자 추가 · 반환 Promise<void> → Promise<Receipt>
   📍 payment-client.ts:42  const r = await charge(100)     ← 클릭하면 그 줄로 점프
```

- **무엇이** 바뀌었나 — 바뀐 심볼(`charge`)
- **어떻게** — 시그니처 before→after + 사람 말 요약(`currency 인자 추가`)
- **어디서** 깨지나 — 네 코드의 실제 사용 줄(클릭 점프)
- **얼마나** — severity(계약 변경=경고, 추가=주의, 내부=조용)

> LSP의 Find References와 다른 점: **네가 모르는 변경**을, **다른 repo**에서, **저장/PR 순간** 너에게 밀어준다.

---

## 두 시점, 한 피드

| 레이어 | 언제 | 어디에 |
|---|---|---|
| 🔵 **저장 (라이브)** | 팀원이 `Ctrl+S` 하는 순간 | VS Code 변경 피드 + 알림strip |
| 🟣 **PR (게이트)** | PR 열림/갱신 | 같은 변경 피드(PR 뱃지) + GitHub PR 코멘트 |

둘 다 **같은 엔진**으로 분석한다.

---

## 엔진은 LLM이 아니라 결정론적 의존 그래프 (측정으로 증명)

"AI가 영향을 읽는다" 의 핵심은 LLM이 아니었다. 실제 3개 repo(autobe·grida·wrtn-fe)에서 측정:

| 엔진 | Precision | Recall |
|---|---|---|
| **graph** (결정론·무료) | **78~97%** | **100%** |
| LLM 단독 (haiku/sonnet) | 64~70% | 54~56% |
| 파일명 추측(mock) | — | 2~6% |

**유료 LLM이 무료 graph보다 못하다(2모델 독립 확인).** 측정 안 했으면 free 정적분석보다 나쁜 "AI-powered"를 출시할 뻔.
근거·하네스는 [`scripts/README.md`](scripts/README.md).

---

## 그냥 설치하면 됨 (설정 0)

- **혼자**: 익스텐션 설치 = 끝. 로컬 두뇌 자동 기동.
- **같은 사무실(LAN)**: 다같이 설치 = 끝. 먼저 켠 사람이 두뇌 host, 나머지는 **자동 발견**(고정 IP 0, host 바뀌어도 자가치유).
- **같은 repo = 자동으로 같은 팀** (git 원격에서 도출, 다른 프로젝트와 격리).
- Win·Mac·Linux 단일 `.vsix`. Cursor·Windsurf 동일.

→ 설치/배포: [USAGE.md](USAGE.md) · [DEPLOY.md](DEPLOY.md) · 릴리스/업데이트: [RELEASING.md](RELEASING.md)

---

## 구조

```
   ┌─ VS Code 익스텐션 ─┐   ← Cursor·Windsurf 동일. 두뇌 자동기동·LAN 자동발견
   │  · 저장 diff + 열린 PR 을 두뇌로
   │  · 변경 피드(어디/어떻게/영향) + 사용처 점프
   └──────────┬─────────┘
              │ WebSocket (팀 room 으로 격리)
              ▼
   ┌──────────────────────────────┐
   │  두뇌 (graph 엔진)            │
   │  · 의존 엣지로 영향자 판정     │
   │  · 같은 팀에게만 브로드캐스트  │
   └──────────────────────────────┘
   + GitHub Action: PR diff 를 같은 엔진에 → PR 코멘트
```

| 경로 | 내용 |
|---|---|
| [`backend/`](backend/) | 두뇌. WS 서버 + graph 엔진. `npx ripple-brain` / Docker |
| [`extension/`](extension/) | VS Code 익스텐션. 저장+PR 감지 → 피드 |
| [`scripts/`](scripts/) | 측정 하네스(eval) · PR 영향 게이트(pr-impact) |

---

## 품질

- 테스트 72(단위+실서버 통합) · CI · 보안 하드닝(토큰 인증·DoS 캡·비밀 파일 제외·입력 검증)
- 엔진은 저장/PR 양쪽에서 동일 — 어렵게 만들고 측정한 자산을 재사용.

## 한계 (정직)

- precision 78~97%(코드베이스별) — **거의 안 놓치되(recall 100%) 가끔 "import는 하지만 그 심볼은 안 쓰는" 파일을 같이 짚는다.** 알림엔 놓치는 것보다 나은 트레이드.
- 두뇌는 in-memory + 팀 room broadcast. 한 팀(신뢰 그룹) 규모용. 기본 graph는 코드 외부 전송 0(LLM 모드만 opt-in).
- 크로스-언어/계약(OpenAPI·스키마) 영향은 아직 — 정적 엣지 위주.

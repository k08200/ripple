# 🌊 Ripple — Live Change Impact

**팀원이 코드를 저장하는 순간, 그 변경이 *네 코드의 어디를 어떻게 깨는지* 자동으로 알려준다.**

각자 VS Code(또는 Cursor·Windsurf)에 깔고 공용 백엔드 하나에 붙으면, 누가 저장하든
**코드 의존(import·시그니처·스키마·라우트)으로 닿는 사람에게만** 알림이 간다. 역할(프론트/백) 무관 — any-to-any.

> Git은 커밋된 스냅샷만 본다. Ripple은 **저장하는 순간**을 잡아 라이브로 흘린다.
> 엔진은 LLM이 아니라 **결정론적 의존 그래프** — 실제 3개 repo에서 recall 100% / precision 78~97%로 측정됨(무료·키 불필요).

## 무엇을 보여주나

팀원 alice가 `charge()` 시그니처를 바꿔 저장하면, 네 화면에:

```
🌊 alice · payment-api/src/payment.ts → 너의 payment-client.ts:5 외 2곳 영향
   charge: currency 인자 추가 · 반환 Promise<void> → Promise<Receipt>
```

그리고 **변경 피드** 패널에:

- **무엇이** — 바뀐 심볼(`charge`)
- **어떻게** — `currency 인자 추가 · 반환 void → Receipt` + before/after 원문(빨강/초록)
- **어디서** — 네 코드의 실제 사용 줄들(`payment-client.ts:5`, `:11` …) — **클릭하면 그 줄로 점프**
- **얼마나** — severity(계약 변경=경고, 추가=주의, 내부=조용)

LSP의 Find References와 다른 점: **네가 모르는 변경**을, **다른 repo**에서, **저장 순간** 너에게 밀어준다.

## 빠른 시작

**혼자/체험 — 그냥 설치하면 끝.** 확장이 로컬 두뇌를 자동으로 띄운다(별도 배포 0). 저장하면 변경 피드에 흐른다.

**팀으로 — 공용 두뇌 하나만.** 여러 컴퓨터를 잇는 relay가 필요하다(이게 "팀원이 저장하면 너에게"의 조건):
1. 어느 호스트든 두뇌 하나: `npx ripple-brain` (또는 Docker — [DEPLOY.md](https://github.com/k08200/ripple/blob/main/DEPLOY.md))
2. 각자 설정 `ripple.backendUrl`을 그 주소로 (원격이면 자동기동은 자동으로 꺼짐).

좌측 🌊 아이콘 = 변경 피드, 하단 상태바 = 연결/팀/영향 수.

## 설정

| 키 | 기본값 | 설명 |
|---|---|---|
| `ripple.backendUrl` | `ws://localhost:7077` | 백엔드 WebSocket 주소 |
| `ripple.userId` | (OS 사용자명) | 팀에서 나를 식별하는 이름 |
| `ripple.secret` | (없음) | 공유 백엔드 인증 토큰(백엔드 `RIPPLE_SECRET`와 일치). 비우면 인증 없음(로컬용) |
| `ripple.autoStartBrain` | `true` | 로컬 주소면 두뇌를 자동 기동(설치만 하면 됨). 팀 공용 두뇌를 쓰면 `backendUrl`을 원격으로 두면 자동기동 안 함 |

## 명령

- `Ripple: 변경 피드 열기`
- `Ripple: 백엔드 재연결`
- `Ripple: 워크스페이스 재인덱싱`

## 프라이버시

`.env`·`.pem`·`.key`·secret/credential 류 파일은 분석·전송에서 자동 제외된다.
기본 `graph` 엔진은 코드를 외부로 보내지 않는다(전부 로컬 결정론). LLM 모드는 명시적 opt-in.

Cursor · Windsurf 에서도 동일 확장 API로 그대로 동작. MIT License.

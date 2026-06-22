# Ripple — 로컬 테스트

빌드는 끝나 있다 (`backend/dist`, `extension/dist`). 아래 3가지로 테스트한다.

## 0. 백엔드 두뇌 띄우기 (먼저)

```bash
npm run build          # 한 번만 (이미 빌드됨)
npm run brain          # ws://localhost:7077, graph provider (기본·키 불필요)
# 진짜 Claude 로:        ANTHROPIC_API_KEY=sk-... npm run brain
# provider 강제:         RIPPLE_PROVIDER=mock|graph|claude npm run brain
```

확인: `curl http://localhost:7077/health` → `{"ok":true,"provider":"graph|claude",...}`

provider 우선순위: `RIPPLE_PROVIDER` 강제 > `ANTHROPIC_API_KEY` 있으면 claude > 없으면 **graph**(결정론적 의존 그래프). 실패 시 graph 로 폴백.

## 1. E2E 흐름 테스트 — VS Code 없이 "저장 → 영향 알림" 증명

다른 터미널에서:

```bash
npm run sim
```

alice(payment-api) 가 `charge()` 시그니처를 바꿔 저장 → bob(web) 이 "🌊 너에게 영향" 을 받고,
carol(ml) 은 안 받는지 확인한다. **전체 배선이 도는지** 보는 용도.

> 참고: 현재 mock 은 `payment-api/src/db.ts` 를 오탐으로 끼워넣는다 (repo 이름에 "payment" 포함).
> 이게 아래 eval 이 잡아내는 precision 문제다.

## 2. Phase 0 정확도 측정 — 제품의 진짜 지표

```bash
npm run eval                              # mock 채점
ANTHROPIC_API_KEY=sk-... npm run eval     # Claude 채점
```

`scripts/cases.json` 의 변경 케이스로 provider 별 **precision / recall / severity 정확도**를 나란히 낸다.

| provider | Precision | Recall | Severity |
|---|---|---|---|
| mock (파일명 추측) | 75% | 50% | 50% |
| **graph (의존 엣지)** | **100%** | **83%** | **100%** |

graph 가 놓치는 1건은 "DB 컬럼 추가(additive)" — 아직 아무도 참조 안 하는 새 심볼이라 정적 엣지로는 안 보인다.
**여기가 LLM(claude provider)이 보태는 자리**다. graph 와 claude 는 경쟁이 아니라 합성.

### 실제 repo ground truth (진짜 게이트)

합성 케이스는 내가 만든 것 → 못 믿는다. **실제 git 히스토리에서 ground truth를 캔다.**
한 커밋이 export 를 바꾸고 "같은 커밋에서" importer 들을 고쳤다면, 그 importer = 실제 영향받음.

```bash
node scripts/gen-cases.mjs /path/to/real-repo 14   # → scripts/cases.real.json
node scripts/eval.mjs scripts/cases.real.json       # 실측 채점
```

**표본 크기 주의 (정직)**: 14건에선 graph P94 였지만, **40건으로 늘리면 P74 / R100 / Sev73**.
14건 P94 는 낙관적 표본이었다. 단, 이 P74 는 **하한선**이다 — graph 의 "FP" 는 대부분
"그 모듈을 import 하는 진짜 의존 파일인데 해당 단일 커밋에선 안 고쳐진 것"(단일-커밋 GT 의 한계)이다.
refHit-only 로 좁혀 검증: R100→19, P74→36 폭락 → **importHit 이 recall 의 대부분을 짊어짐**(바뀐 심볼이
본문에서 쓰이면 named-import refs 에 안 잡힘). 즉 recall 은 14·40 양쪽 견고하게 100%, precision 실측 74%(실제는 더 높음).

autobe(2339 커밋) 14건 실측 결과:

| provider | Precision | Recall | F1 | Severity |
|---|---|---|---|---|
| mock | 100%* | **2%** | 4% | 50% |
| **graph** | **94%** | **100%** | **97%** | 79%† |

\* mock 은 실제 코드에서 거의 아무것도 못 찾음(예측 자체가 없어 precision 이 허수). graph 가 게이트(70/50)를 실측으로 넘김.
† severity 79% 는 graph 약점이 아니라 **diff-휴리스틱 라벨의 한계** — 불일치를 까보면 export-only 라벨이 필드/중첩 인터페이스 제거를 놓쳐 graph 가 오히려 맞는 쪽. 진짜 severity 게이트는 LLM/사람 라벨이 필요.

**해결된 것**:
- Recall 88→100% — 원인은 barrel 이 아니라 `MAX_AFFECTED=8` 캡이 고-팬아웃 변경을 잘라낸 것. 캡 50 으로 올리고 확신도순 정렬([graph.ts](../backend/src/providers/graph.ts)).

### LLM 실측 — 가설이 깨졌다 (중요)

"정적 엣지로 안 보이는 additive·의미적 영향은 LLM이 보탤 것" 이라 가정하고 graph+LLM hybrid 를 실측했다.
같은 autobe 14케이스, OpenRouter 경유 두 모델:

| provider | Precision | Recall | F1 | Severity |
|---|---|---|---|---|
| **graph** (무료·결정론) | **94%** | **100%** | **97%** | **79%** |
| LLM 단독 (claude-haiku-4.5) | 70% | 54% | 61% | 71% |
| LLM 단독 (claude-sonnet-4.6) | 64% | 56% | 60% | 50% |
| hybrid (graph+haiku) | 74% | 100% | 85% | 71% |
| hybrid (graph+sonnet) | 70% | 100% | 82% | 64% |

**결론: 유료 LLM이 무료 graph보다 못하다.** 두 모델 독립 확인. LLM 단독은 importer 절반을 놓치고(recall 54~56%),
hybrid 는 union 으로 recall 은 지키지만 LLM 오탐이 precision 을 94→70~74 로 끌어내리고 max-severity 가 overshoot.
**naive 합성은 순손해.** 이 제품의 핵심(누가 영향받나)은 결정론적 의존 그래프가 엔진이고, "AI 가 읽는다"는 헤드라인이 아니다.

정직한 한계: ① ground truth 가 import 기반이라 구조적으로 graph 에 유리(LLM 이 잡은 비-import 의미 영향은 FP 로 깎임). ② 토큰 한도로 LLM 프롬프트를 트림(MAX_KNOWN=50)해 context 가 graph 보다 적었음. 그래도 헤드라인(정적>LLM)은 뒤집히지 않음.

LLM 의 자리는: graph 가 **증명적으로 못 보는** 케이스(additive)에 한해 **gating 후** 보조, 또는 사람용 summary 텍스트 — 핵심 라우팅 결정은 graph.

### gated hybrid 까지 측정 — LLM 의 niche 는 실재하나 비싸다

naive union 이 졌으니 **gating** 으로 좁혔다: graph severity 가 `high`/`info` 면 graph 단독(LLM 무시), `low`(additive, graph 의 맹점)일 때만 LLM 보조. severity 는 graph 것 유지.

| 벤치마크 | graph | gated hybrid |
|---|---|---|
| 실데이터 14 (import 기반 GT) | **P94 / R100 / F1 97** | P89 / R100 / F1 94 |
| 합성 6 (additive 포함) | P100 / R83 / F1 91 | P86 / R100 / **F1 92** |

- 실데이터: gated 도 **graph 에 못 미침** — additive 케이스에서 LLM 이 FP 만 보탬.
- 합성: gated 가 graph 의 additive 맹점(case2)을 **메움**(R 83→100) — 하지만 precision 100→86 지불. F1 +1.

**최종 결론**: LLM 은 graph 가 못 보는 additive 영향을 잡을 수 **있으나 precision 을 지불**한다.
신뢰 민감한 저장-시점 알림에선 (오탐 > 미스 비용, additive 는 애초에 low) **나쁜 거래.**
→ 기본 provider = graph 고정. `RIPPLE_PROVIDER=hybrid` 는 "additive 미스보다 약간의 노이즈가 낫다"는 팀만 opt-in.
LLM 4구성(solo·naive·gated × haiku·sonnet) 어느 것도 실데이터에서 graph 를 못 넘었다.

## 3. 진짜 VS Code 익스텐션으로 (선택)

```bash
code extension/        # extension 폴더 열고
# F5 (Run Ripple Extension) → 새 창에서 파일 저장 시 백엔드로 전송
```

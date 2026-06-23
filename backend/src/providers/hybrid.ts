import type { AffectedHint } from "../protocol.js";
import type { AnalyzeInput, AnalyzeResult, Provider } from "./provider.js";
import { GraphProvider } from "./graph.js";

// graph + LLM 합성 (gated).
//
// 측정 교훈: naive union(어디서나 LLM 합치기)은 graph 가 강한 high-fanout 케이스에
// LLM 오탐을 보태 precision 을 94→70 으로 깎았다. 그래서 gating:
// - graph severity == "high": 강한 정적 신호. graph 단독 (LLM 무시 → 오탐 차단).
// - graph severity == "low":  additive — graph 의 증명적 맹점. 여기서만 LLM 보조.
// - graph severity == "info": graph 가 "영향 없음" 확신. 그대로 (노이즈 억제).
// severity 는 항상 graph 것 유지 (graph 가 LLM 보다 정확: 79% vs 50~71%, overshoot 차단).

const MAX_AFFECTED = 50;

function norm(p: string): string {
  return p.toLowerCase().replace(/\.[^./]+$/, "").trim();
}

export class HybridProvider implements Provider {
  readonly name = "hybrid";
  private readonly graph = new GraphProvider();
  private readonly llm: Provider;

  constructor(llm: Provider) {
    this.llm = llm;
  }

  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const graphResult = await this.graph.analyze(input);

    // graph 가 강하거나(또는 영향 없다고) 확신하면 LLM 을 부르지 않는다.
    if (graphResult.severity !== "low") return graphResult;

    let llmResult: AnalyzeResult | null = null;
    try {
      llmResult = await this.llm.analyze(input);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[hybrid] LLM(${this.llm.name}) 실패 → graph 단독:`, reason);
    }
    if (!llmResult) return graphResult;

    // additive 케이스에서만: graph 가 못 본 영향을 LLM 이 보탠다 (graph 우선, 새 경로만).
    const seen = new Set(graphResult.affected.map((a) => norm(a.pathHint)));
    const merged: AffectedHint[] = [...graphResult.affected];
    for (const a of llmResult.affected) {
      const key = norm(a.pathHint);
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push({ pathHint: a.pathHint, reason: `${a.reason} (LLM)` });
      }
    }

    return {
      summary: graphResult.summary,
      severity: graphResult.severity,
      affected: merged.slice(0, MAX_AFFECTED),
    };
  }
}

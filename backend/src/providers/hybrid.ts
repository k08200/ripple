import type { AffectedHint, Severity } from "../protocol.js";
import type { AnalyzeInput, AnalyzeResult, Provider } from "./provider.js";
import { GraphProvider } from "./graph.js";

// graph + LLM 합성.
// - affected: graph(정확한 정적 엣지) ∪ LLM(additive·의미적 영향) — 중복 제거.
// - severity: 둘 중 더 심각한 쪽 (한쪽이라도 깨짐을 보면 깨짐).
// graph 가 실패할 일은 없고(결정론), LLM 이 죽으면 graph 결과만으로 폴백.

const RANK: Record<Severity, number> = { info: 0, low: 1, high: 2 };

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

    let llmResult: AnalyzeResult | null = null;
    try {
      llmResult = await this.llm.analyze(input);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[hybrid] LLM(${this.llm.name}) 실패 → graph 단독:`, reason);
    }
    if (!llmResult) return graphResult;

    // affected 합집합 (graph 우선, LLM 은 새 경로만 추가)
    const seen = new Set(graphResult.affected.map((a) => norm(a.pathHint)));
    const merged: AffectedHint[] = [...graphResult.affected];
    for (const a of llmResult.affected) {
      const key = norm(a.pathHint);
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push({ pathHint: a.pathHint, reason: `${a.reason} (LLM)` });
      }
    }

    const severity: Severity =
      RANK[llmResult.severity] > RANK[graphResult.severity] ? llmResult.severity : graphResult.severity;

    return {
      summary: graphResult.summary,
      severity,
      affected: merged,
    };
  }
}

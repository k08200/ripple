import type { AnalyzeInput, AnalyzeResult, Provider } from "./providers/provider.js";
import { MockProvider } from "./providers/mock.js";
import { GraphProvider } from "./providers/graph.js";
import { ClaudeProvider } from "./providers/claude.js";
import { OpenRouterProvider } from "./providers/openrouter.js";
import { HybridProvider } from "./providers/hybrid.js";

const env = (k: string) => (process.env[k] ?? "").trim();

/** 키가 있으면 LLM provider(OpenRouter 우선, 없으면 Anthropic)를 만든다. 둘 다 없으면 null. */
function makeLlm(): Provider | null {
  const or = env("OPENROUTER_API_KEY");
  if (or) return new OpenRouterProvider(or);
  const an = env("ANTHROPIC_API_KEY");
  if (an) return new ClaudeProvider(an);
  return null;
}

/**
 * 환경에 맞는 분석 provider 를 고른다.
 * - RIPPLE_PROVIDER=mock|graph|claude|openrouter|hybrid 로 강제 지정
 * - 기본: 항상 graph(결정론적).
 *   실측(scripts/cases.real.json)에서 graph(P94/R100) > LLM 단독(P64~70/R54~56) > naive hybrid.
 *   유료 LLM 이 무료 graph 보다 못해서, 키가 있어도 자동으로 hybrid 를 켜지 않는다.
 */
export function selectProvider(): Provider {
  const forced = env("RIPPLE_PROVIDER").toLowerCase();
  if (forced === "mock") return new MockProvider();
  if (forced === "claude") return new ClaudeProvider(env("ANTHROPIC_API_KEY"));
  if (forced === "openrouter") return new OpenRouterProvider(env("OPENROUTER_API_KEY"));
  if (forced === "hybrid") return new HybridProvider(makeLlm() ?? new GraphProvider());
  return new GraphProvider();
}

const fallback = new GraphProvider();

/** provider 호출. 실패하면 조용히 죽지 않고 graph 로 폴백한다. */
export async function analyze(
  provider: Provider,
  input: AnalyzeInput,
): Promise<{ result: AnalyzeResult; usedProvider: string }> {
  try {
    return { result: await provider.analyze(input), usedProvider: provider.name };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[analyzer] ${provider.name} 실패 → graph 폴백:`, reason);
    return { result: await fallback.analyze(input), usedProvider: "graph(fallback)" };
  }
}

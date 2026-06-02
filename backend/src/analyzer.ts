import type { AnalyzeInput, AnalyzeResult, Provider } from "./providers/provider.js";
import { MockProvider } from "./providers/mock.js";
import { ClaudeProvider } from "./providers/claude.js";

/**
 * 환경에 맞는 분석 provider 를 고른다.
 * - ANTHROPIC_API_KEY 있으면 Claude
 * - 없으면 Mock (휴리스틱) — 키 없이도 데모가 돈다
 * 미정 사항(클코 vs 코덱스)은 여기서 provider 만 바꾸면 됨.
 */
export function selectProvider(): Provider {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.trim().length > 0) return new ClaudeProvider(key.trim());
  return new MockProvider();
}

const mock = new MockProvider();

/** provider 호출. 실패하면 조용히 죽지 않고 mock 으로 폴백한다. */
export async function analyze(
  provider: Provider,
  input: AnalyzeInput,
): Promise<{ result: AnalyzeResult; usedProvider: string }> {
  try {
    return { result: await provider.analyze(input), usedProvider: provider.name };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[analyzer] ${provider.name} 실패 → mock 폴백:`, reason);
    return { result: await mock.analyze(input), usedProvider: "mock(fallback)" };
  }
}

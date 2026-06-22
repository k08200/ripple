import type { AnalyzeInput, AnalyzeResult, Provider } from "./provider.js";
import { SYSTEM_PROMPT, buildUserPrompt, coerceResult, extractJson } from "./llm.js";

// Claude (Anthropic Messages API) 기반 영향 분석기. SDK 없이 fetch.
// OpenRouter 로 바꾸려면 OpenRouterProvider 를 쓴다 (동일 Provider 인터페이스).

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

export class ClaudeProvider implements Provider {
  readonly name = "claude";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = process.env.RIPPLE_MODEL ?? DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as AnthropicResponse;
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    return coerceResult(extractJson(text));
  }
}

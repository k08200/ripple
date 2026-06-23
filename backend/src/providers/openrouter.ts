import type { AnalyzeInput, AnalyzeResult, Provider } from "./provider.js";
import { SYSTEM_PROMPT, buildUserPrompt, coerceResult, extractJson } from "./llm.js";

// OpenRouter (OpenAI-호환 chat completions) 기반 영향 분석기.
// 모델은 RIPPLE_MODEL 로 지정 (예: anthropic/claude-3.5-sonnet, openai/gpt-4o-mini ...).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export class OpenRouterProvider implements Provider {
  readonly name = "openrouter";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = process.env.RIPPLE_MODEL ?? DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const body = JSON.stringify({
      model: this.model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    });

    // 무료/제한 키는 429(rpm) 가 흔하다 → 백오프 재시도.
    const MAX_RETRY = 6;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "x-title": "Ripple",
        },
        body,
        signal: AbortSignal.timeout(30_000), // 멈춘 업스트림이 분석 파이프라인을 영영 막지 않게
      });

      if (res.status === 429 && attempt < MAX_RETRY) {
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        const waitMs = reset && reset > 0 ? Math.min(20_000, Math.max(2000, reset - Date.now())) : 9000;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as ChatResponse;
      if (data.error) throw new Error(`OpenRouter: ${data.error.message ?? "unknown"}`);
      return coerceResult(extractJson(data.choices?.[0]?.message?.content ?? ""));
    }
  }
}

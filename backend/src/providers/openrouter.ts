import type { AnalyzeInput, AnalyzeResult, Provider } from "./provider.js";
import { SYSTEM_PROMPT, buildUserPrompt, coerceResult, extractJson, LLM_MAX_TOKENS, LLM_TIMEOUT_MS } from "./llm.js";

// OpenRouter (OpenAI-호환 chat completions) 기반 영향 분석기.
// 모델은 RIPPLE_MODEL 로 지정 (예: anthropic/claude-3.5-sonnet, openai/gpt-4o-mini ...).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

// 429(rpm) 백오프 — reset 헤더가 없을 때의 대기, 그리고 헤더 기반 대기의 하/상한.
const MAX_RETRY = 6;
const BACKOFF_DEFAULT_MS = 9000;
const BACKOFF_MIN_MS = 2000;
const BACKOFF_MAX_MS = 20_000;

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
      max_tokens: LLM_MAX_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    });

    // 무료/제한 키는 429(rpm) 가 흔하다 → 백오프 재시도.
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "x-title": "Ripple",
        },
        body,
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });

      if (res.status === 429 && attempt < MAX_RETRY) {
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        const waitMs =
          reset && reset > 0
            ? Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, reset - Date.now()))
            : BACKOFF_DEFAULT_MS;
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

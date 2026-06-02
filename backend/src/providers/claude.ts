import type { AffectedHint, Severity } from "../protocol.js";
import type { AnalyzeInput, AnalyzeResult, Provider } from "./provider.js";

// Claude (Anthropic Messages API) 기반 영향 분석기.
// SDK 의존성 없이 fetch 로 직접 호출 → 버전/번들 마찰 제거.
// 코덱스로 바꾸려면 동일한 Provider 인터페이스로 CodexProvider 만 추가하면 됨.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_KNOWN_FILES = 200;

const SYSTEM_PROMPT = `너는 코드 변경 영향 분석기다.
하나의 파일 diff 와 "팀 전체 파일 목록"을 받는다.
이 변경이 팀 목록 안의 어떤 파일/심볼에 영향을 줄 수 있는지 판단해라.
역할(프론트/백)로 추측하지 말고 실제 코드 의존(시그니처, 스키마, export, 라우트, 반환 타입 변화)으로만 판단해라.
반드시 아래 JSON 만 출력한다. 설명/마크다운/코드펜스 금지.
{
  "summary": "사람이 읽는 한 줄 요약 (한국어)",
  "severity": "info" | "low" | "high",
  "affected": [{ "pathHint": "팀 목록 속 경로 또는 심볼", "reason": "왜 영향받는지 한 줄" }]
}
severity: high=호환성 깨질 수 있음(계약/시그니처/스키마 변경), low=주의, info=영향 거의 없음.
affected 는 정말 영향 가능한 것만. 없으면 빈 배열.`;

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("응답에서 JSON 을 찾지 못함");
  return JSON.parse(raw.slice(start, end + 1));
}

function coerceResult(parsed: unknown): AnalyzeResult {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const severity: Severity =
    obj.severity === "high" || obj.severity === "low" ? obj.severity : "info";
  const affected: AffectedHint[] = Array.isArray(obj.affected)
    ? obj.affected
        .map((a): AffectedHint => {
          const h = (a ?? {}) as Record<string, unknown>;
          return {
            pathHint: String(h.pathHint ?? "").slice(0, 300),
            reason: String(h.reason ?? "").slice(0, 300),
          };
        })
        .filter((h) => h.pathHint.length > 0)
    : [];
  return {
    summary: String(obj.summary ?? "변경 분석됨").slice(0, 500),
    severity,
    affected,
  };
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
    const knownList = input.knownFiles.slice(0, MAX_KNOWN_FILES).join("\n");
    const userPrompt =
      `# 변경된 파일\n${input.repo}/${input.file}\n\n` +
      `# diff\n${input.diff}\n\n` +
      `# 팀 전체 파일 목록\n${knownList}`;

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
        messages: [{ role: "user", content: userPrompt }],
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

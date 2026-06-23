import type { AffectedHint, Severity } from "../protocol.js";
import type { AnalyzeInput, AnalyzeResult } from "./provider.js";

// LLM provider 공통 로직 (Claude / OpenRouter 가 공유).
// 핵심: 프롬프트에 "파일명" 만이 아니라 심볼 인덱스(exports/imports)를 실어준다 →
//       모델이 추측이 아니라 실제 의존 신호로 판단.

const MAX_KNOWN = 50;
const MAX_DIFF_CHARS = 2500;
const MAX_SYM = 5;

/** LLM provider 공통 요청 파라미터 (claude·openrouter 공유). */
export const LLM_TIMEOUT_MS = 30_000; // 멈춘 업스트림이 분석 파이프라인을 막지 않게
export const LLM_MAX_TOKENS = 1024;

export const SYSTEM_PROMPT = `너는 코드 변경 영향 분석기다.
하나의 파일 diff 와 "팀 파일 목록(경로 | exports | imports)" 을 받는다.
이 변경이 목록 안의 어떤 파일/심볼에 영향을 줄 수 있는지 판단해라.
역할(프론트/백)로 추측하지 말고 실제 코드 의존(import, 시그니처, 스키마, export, 라우트, 타입 필드 변화)으로만 판단해라.
새로 추가된 필드/엔드포인트처럼 "아직 아무도 안 쓰지만 곧 처리해야 하는" 영향도 짚어라(그건 보통 low).
반드시 아래 JSON 만 출력한다. 설명/마크다운/코드펜스 금지.
{
  "summary": "사람이 읽는 한 줄 요약 (한국어)",
  "severity": "info" | "low" | "high",
  "affected": [{ "pathHint": "목록 속 경로 또는 심볼", "reason": "왜 영향받는지 한 줄" }]
}
severity: high=호환성 깨질 수 있음(계약/시그니처/스키마 제거·변경), low=주의/추가, info=영향 거의 없음.
affected 는 정말 영향 가능한 것만. 없으면 빈 배열.`;

export function buildUserPrompt(input: AnalyzeInput): string {
  const idx = input.knownIndex ?? [];
  const lines =
    idx.length > 0
      ? idx
          .slice(0, MAX_KNOWN)
          .map((k) => {
            const ex = k.exports.slice(0, MAX_SYM).join(",");
            const im = k.imports.slice(0, MAX_SYM).join(",");
            return `${k.path} | exports: ${ex || "-"} | imports: ${im || "-"}`;
          })
          .join("\n")
      : input.knownFiles.slice(0, MAX_KNOWN).join("\n");

  const diff =
    input.diff.length > MAX_DIFF_CHARS
      ? input.diff.slice(0, MAX_DIFF_CHARS) + "\n…(생략)"
      : input.diff;

  return (
    `# 변경된 파일\n${input.repo}/${input.file}\n\n` +
    `# diff\n${diff}\n\n` +
    `# 팀 파일 (경로 | exports | imports)\n${lines}`
  );
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("응답에서 JSON 을 찾지 못함");
  return JSON.parse(raw.slice(start, end + 1));
}

export function coerceResult(parsed: unknown): AnalyzeResult {
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
    changedSymbols: [],
    changeDetails: [],
  };
}

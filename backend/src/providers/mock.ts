import type { AffectedHint, Severity } from "../protocol.js";
import type { AnalyzeInput, AnalyzeResult, Provider } from "./provider.js";
import { changedLines } from "../diff-lines.js";

// API 키 없이도 데모가 굴러가도록 하는 휴리스틱 분석기.
// 진짜 분석은 ClaudeProvider 가 한다. 여기는 "구조가 돈다"를 증명하는 fallback.

const BREAKING_SIGNALS = [
  "export",
  "interface",
  "type ",
  "schema",
  "route",
  "endpoint",
  "api",
  "public",
  "func ",
  "def ",
  "class ",
  "return",
];

/** "auth.ts" -> "auth", "user-service.go" -> "user-service" */
function baseName(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.[^.]+$/, "");
}

function severityOf(added: string[], removed: string[]): Severity {
  const all = [...added, ...removed].join("\n").toLowerCase();
  const breaking = BREAKING_SIGNALS.some((s) => all.includes(s));
  if (removed.length > 0 && breaking) return "high"; // 시그니처/계약 제거 가능성
  if (breaking) return "low";
  return "info";
}

export class MockProvider implements Provider {
  readonly name = "mock";

  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const { added, removed } = changedLines(input.diff);
    const severity = severityOf(added, removed);
    const me = baseName(input.file);

    // 변경된 파일의 이름을 언급하거나 import 하는 다른 파일 = 영향 후보.
    const affected: AffectedHint[] = input.knownFiles
      .filter((f) => f !== input.file && !f.endsWith(`/${input.file}`))
      .filter((f) => f.toLowerCase().includes(me.toLowerCase()))
      .slice(0, 5)
      .map((f) => ({
        pathHint: f,
        reason: `${me} 를 참조할 가능성이 있어 변경 영향을 받을 수 있음`,
      }));

    const verb = removed.length > added.length ? "삭제/축소" : "수정";
    const summary =
      `${input.file} ${verb} (+${added.length}/-${removed.length})` +
      (severity === "high" ? " · 계약 변경 가능성" : "");

    return { summary, severity, affected };
  }
}

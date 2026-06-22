import type { AffectedHint, Severity } from "../protocol.js";
import type { AnalyzeInput, AnalyzeResult, KnownFile, Provider } from "./provider.js";

// 결정론적 의존 그래프 영향 분석기 (Phase 1).
// 파일명 추측이 아니라 실제 import/참조 엣지로 판단한다. API 키 불필요.
//
// 한계(정직하게): 정적 엣지만 본다. 추가(additive)·의미적 영향은 못 잡는다 —
// 거기는 LLM(ClaudeProvider)이 보탠다. 그래서 둘은 경쟁이 아니라 합성이다.

// 고-팬아웃 계약 변경(인터페이스 하나가 수십 곳에 영향)은 실제로 흔하다.
// 캡을 낮게 잡으면 진짜 영향자를 조용히 떨군다 → recall 손실. 넉넉히 잡고 확신도 순으로 정렬.
const MAX_AFFECTED = 50;

const EXPORT_RE =
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST_RE = /\bexport\s*\{([^}]*)\}/g;
const ROUTE_RE = /['"`](\/[\w/:.-]*)['"`]/g;
// TS/JS 인터페이스 필드: "  name: Type" / "  name?: Type"
const TS_FIELD_RE = /^\s*([A-Za-z_$][\w$]*)\??\s*:\s*\S/;
// Prisma/스키마 필드: "  name Type" (대문자 타입으로 시작)
const SCHEMA_FIELD_RE = /^\s*([A-Za-z_$][\w$]*)\s+[A-Z]\w*/;

interface Changed {
  added: string[];
  removed: string[];
}

function changedLines(diff: string): Changed {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
    else if (line.startsWith("-") && !line.startsWith("---")) removed.push(line.slice(1));
  }
  return { added, removed };
}

function basename(spec: string): string {
  const last = spec.split("/").pop() ?? spec;
  return last.replace(/\.[^.]+$/, "");
}

function collectExports(lines: string[]): Set<string> {
  const out = new Set<string>();
  const text = lines.join("\n");
  for (const m of text.matchAll(EXPORT_RE)) out.add(m[1]);
  for (const m of text.matchAll(EXPORT_LIST_RE)) {
    for (const name of m[1].split(",")) {
      const id = name.trim().split(/\s+as\s+/)[0].trim();
      if (id) out.add(id);
    }
  }
  return out;
}

function collectRoutes(lines: string[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) for (const m of line.matchAll(ROUTE_RE)) out.add(m[1]);
  return out;
}

function collectFields(lines: string[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) {
    const ts = TS_FIELD_RE.exec(line);
    if (ts && !/[(){}]/.test(line)) out.add(ts[1]);
    const sc = SCHEMA_FIELD_RE.exec(line);
    if (sc) out.add(sc[1]);
  }
  return out;
}

function diffSet<T>(a: Set<T>, b: Set<T>): Set<T> {
  return new Set([...a].filter((x) => !b.has(x)));
}

export class GraphProvider implements Provider {
  readonly name = "graph";

  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const { added, removed } = changedLines(input.diff);

    const expAdded = collectExports(added);
    const expRemoved = collectExports(removed);
    const modified = new Set([...expAdded].filter((x) => expRemoved.has(x))); // 같은 이름이 +/- 양쪽 = 시그니처 변경
    const routesAdded = collectRoutes(added);
    const routesRemoved = collectRoutes(removed);
    const fieldsRemoved = collectFields(removed);
    const fieldsAdded = diffSet(collectFields(added), fieldsRemoved);
    const routesChanged =
      [...routesRemoved, ...routesAdded].length > 0 &&
      ([...diffSet(routesRemoved, routesAdded)].length > 0 || [...diffSet(routesAdded, routesRemoved)].length > 0);

    // 계약 깨짐(제거/시그니처 변경/라우트 변경/필드 제거) vs 추가(additive)
    const contractBroken = new Set<string>([
      ...modified,
      ...diffSet(expRemoved, modified),
      ...fieldsRemoved,
    ]);
    const additive = new Set<string>([...diffSet(expAdded, modified), ...fieldsAdded]);

    let severity: Severity = "info";
    if (contractBroken.size > 0 || routesChanged) severity = "high";
    else if (additive.size > 0) severity = "low";

    const myBase = basename(input.file);
    const myFull = `${input.repo}/${input.file}`;

    // 영향 후보 매칭에 쓸 키: 바뀐 심볼 이름 + 라우트 경로.
    const changedKeys = new Set<string>([
      ...contractBroken,
      ...additive,
      ...routesAdded,
      ...routesRemoved,
    ]);

    const index: KnownFile[] = input.knownIndex ?? [];
    const refHits: AffectedHint[] = [];
    const importHits: AffectedHint[] = [];

    // info(내부 구현/주석만) 면 영향 없음 — 오탐을 원천 차단.
    if (severity !== "info") {
      for (const kf of index) {
        if (kf.path === myFull) continue;

        const refHit = kf.refs.find((r) => changedKeys.has(r));
        if (refHit) {
          refHits.push({ pathHint: kf.path, reason: `${refHit} 를 직접 참조 → 변경 영향` });
        } else if (kf.imports.some((spec) => basename(spec) === myBase)) {
          importHits.push({ pathHint: kf.path, reason: `${input.file} 를 import → 변경 영향` });
        }
      }
    }

    // 확신도 순(직접 참조 > import)으로 정렬 후 캡. 캡에 걸려도 강한 신호가 살아남는다.
    const affected = [...refHits, ...importHits].slice(0, MAX_AFFECTED);

    const verb = removed.length > added.length ? "삭제/축소" : "수정";
    const what =
      contractBroken.size > 0
        ? `계약 변경: ${[...contractBroken].slice(0, 4).join(", ")}`
        : routesChanged
          ? `라우트 변경: ${[...routesRemoved].slice(0, 2).join(", ")}`
          : additive.size > 0
            ? `추가: ${[...additive].slice(0, 4).join(", ")}`
            : "내부 변경";
    const summary = `${input.file} ${verb} · ${what} (영향 ${affected.length}건)`;

    return { summary, severity, affected };
  }
}

import type { AffectedHint, Severity } from "../protocol.js";
import type { AnalyzeInput, AnalyzeResult, ChangeDetail, KnownFile, Provider } from "./provider.js";
import { changedLines } from "../diff-lines.js";

const MAX_DETAIL_LEN = 160;

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** lines 에서 `export ... sym` 선언 줄을 찾아 다듬어 돌려준다. */
function findDecl(lines: string[], sym: string): string | undefined {
  const re = new RegExp(`\\bexport\\b.*\\b${escRe(sym)}\\b`);
  const hit = lines.find((l) => re.test(l));
  return hit ? hit.trim().slice(0, MAX_DETAIL_LEN) : undefined;
}

/** lines 에서 인터페이스/스키마 필드 `name: Type` / `name Type` 선언 줄을 찾는다. */
function findFieldDecl(lines: string[], field: string): string | undefined {
  const f = escRe(field);
  const re = new RegExp(`^\\s*${f}\\??\\s*:|^\\s*${f}\\s+[A-Z]`);
  const hit = lines.find((l) => re.test(l) && !/[(){}]/.test(l)); // 함수/객체 라인 제외
  return hit ? hit.trim().slice(0, MAX_DETAIL_LEN) : undefined;
}

/** 바뀐 export 심볼들의 before→after 선언을 모은다 (어떻게 바뀌었나). */
function buildChangeDetails(added: string[], removed: string[], symbols: Iterable<string>): ChangeDetail[] {
  const out: ChangeDetail[] = [];
  for (const symbol of symbols) {
    const before = findDecl(removed, symbol);
    const after = findDecl(added, symbol);
    if (before || after) out.push({ symbol, before, after });
    if (out.length >= 6) break;
  }
  return out;
}

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
    // 주의: importHit(파일을 import) 가 recall 의 대부분을 짊어진다 — 바뀐 심볼이
    // named-import 가 아니라 본문에서 쓰이면 refs 에 안 잡히기 때문. refHit-only 로
    // 좁히면 R100→19 로 폭락(측정됨). 그래서 둘 다 유지한다.
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

    // 어떻게 바뀌었나: export 심볼(수정/제거/추가)의 before→after 선언.
    const exportSyms = new Set<string>([...modified, ...expRemoved, ...expAdded]);
    const changeDetails = buildChangeDetails(added, removed, exportSyms);
    // 인터페이스/스키마 필드 변경(제거/추가/타입변경)도 before→after 로.
    const fieldSyms = new Set<string>([...collectFields(removed), ...collectFields(added)]);
    const seen = new Set(changeDetails.map((d) => d.symbol));
    for (const f of fieldSyms) {
      if (changeDetails.length >= 6 || seen.has(f)) continue;
      const before = findFieldDecl(removed, f);
      const after = findFieldDecl(added, f);
      if (before || after) {
        changeDetails.push({ symbol: f, before, after });
        seen.add(f);
      }
    }

    return { summary, severity, affected, changedSymbols: [...changedKeys], changeDetails };
  }
}

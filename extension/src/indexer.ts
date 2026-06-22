// 파일 텍스트에서 가벼운 심볼 인덱스(exports/imports/refs)를 뽑는다.
// AST 의존성 없이 정규식 — 빠르고 언어 섞여도 대충 잡힌다. 백엔드 graph provider 가 이걸로 의존 엣지를 판단한다.

import type { FileIndex } from "./protocol";

const MAX_BYTES = 64_000;

const EXPORT_RE =
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST_RE = /\bexport\s*\{([^}]*)\}/g;
const IMPORT_RE = /\bimport\b[^'"]*['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const PY_FROM_RE = /^\s*from\s+([\w.]+)\s+import\b/gm;
const NAMED_IMPORT_RE = /\bimport\s*\{([^}]*)\}/g;
const ROUTE_RE = /['"`](\/[\w/:.-]*)['"`]/g;

function splitNames(group: string): string[] {
  return group
    .split(",")
    .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

export function extractIndex(path: string, text: string): FileIndex {
  const t = text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;

  const exports = new Set<string>();
  for (const m of t.matchAll(EXPORT_RE)) exports.add(m[1]);
  for (const m of t.matchAll(EXPORT_LIST_RE)) for (const n of splitNames(m[1])) exports.add(n);

  const imports = new Set<string>();
  for (const m of t.matchAll(IMPORT_RE)) imports.add(m[1]);
  for (const m of t.matchAll(REQUIRE_RE)) imports.add(m[1]);
  for (const m of t.matchAll(PY_FROM_RE)) imports.add(m[1]);

  const refs = new Set<string>();
  for (const m of t.matchAll(NAMED_IMPORT_RE)) for (const n of splitNames(m[1])) refs.add(n);
  for (const m of t.matchAll(ROUTE_RE)) refs.add(m[1]);

  return { path, exports: [...exports], imports: [...imports], refs: [...refs] };
}

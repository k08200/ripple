// 실제 repo git 히스토리에서 ground-truth 영향 케이스를 캔다.
// 논리: 한 커밋이 파일 F 의 export 심볼을 바꾸고 "같은 커밋에서" F 를 import 하던 파일들을 고쳤다면,
//       그 importer 들은 그 변경에 '실제로 영향받았다'(저자가 원자적으로 고침) = ground truth.
// knownIndex = (같은 커밋의 다른 파일) + (그 커밋과 무관한 distractor 파일들) → precision 도 측정됨.
//
// 실행: node scripts/gen-cases.mjs /path/to/repo [maxCases]  →  scripts/cases.real.json 생성

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename as pathBase } from "node:path";

const REPO = process.argv[2];
const MAX_CASES = Number(process.argv[3] ?? 14);
const SCAN_COMMITS = 500;
const DISTRACTORS = 6;
const GENERIC = new Set(["index", "types", "type", "common", "utils", "util", "constants", "main", "mod", "config"]);

if (!REPO) {
  console.error("사용법: node scripts/gen-cases.mjs /path/to/repo [maxCases]");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));

function git(args) {
  try {
    return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return "";
  }
}

function extractIndex(path, text) {
  const t = text.length > 64000 ? text.slice(0, 64000) : text;
  const exports = new Set();
  const imports = new Set();
  const refs = new Set();
  for (const m of t.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) exports.add(m[1]);
  for (const m of t.matchAll(/\bexport\s*\{([^}]*)\}/g)) for (const n of m[1].split(",")) { const id = n.trim().split(/\s+as\s+/)[0].trim(); if (id) exports.add(id); }
  for (const m of t.matchAll(/\bimport\b[^'"]*['"]([^'"]+)['"]/g)) imports.add(m[1]);
  for (const m of t.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) imports.add(m[1]);
  for (const m of t.matchAll(/\bimport\s*\{([^}]*)\}/g)) for (const n of m[1].split(",")) { const id = n.trim().split(/\s+as\s+/)[0].trim(); if (id) refs.add(id); }
  for (const m of t.matchAll(/['"`](\/[\w/:.-]*)['"`]/g)) refs.add(m[1]);
  return { path, exports: [...exports], imports: [...imports], refs: [...refs] };
}

const baseNoExt = (p) => pathBase(p).replace(/\.[^.]+$/, "");

/** 파일 패치(+/- 라인)에 export 심볼 변경이 있나? */
function patchTouchesExport(patch) {
  for (const line of patch.split("\n")) {
    if ((line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---")) {
      if (/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+[A-Za-z_$]/.test(line)) return true;
    }
  }
  return false;
}

const importsBase = (idx, base) => idx.imports.some((spec) => baseNoExt(spec) === base);

/** patch 의 export 변경이 breaking 인지(제거/시그니처 변경=high, 추가만=low). breaking 의 실제 정의. */
function patchSeverity(patch) {
  const exp = (lines) => {
    const s = new Set();
    for (const l of lines) {
      const m = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(l);
      if (m) s.add(m[1]);
      const m2 = /\bexport\s*\{([^}]*)\}/.exec(l);
      if (m2) for (const n of m2[1].split(",")) { const id = n.trim().split(/\s+as\s+/)[0].trim(); if (id) s.add(id); }
    }
    return s;
  };
  const added = [];
  const removed = [];
  for (const l of patch.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) added.push(l.slice(1));
    else if (l.startsWith("-") && !l.startsWith("---")) removed.push(l.slice(1));
  }
  const ea = exp(added);
  const er = exp(removed);
  const modified = [...er].some((x) => ea.has(x));
  return er.size > 0 || modified ? "high" : "low";
}

// 1) 커밋 스캔
const commits = git(["log", "--pretty=%H", `-n${SCAN_COMMITS}`]).split("\n").filter(Boolean);
const allTsAtHead = git(["ls-tree", "-r", "--name-only", "HEAD"]).split("\n").filter((f) => /\.ts$/.test(f) && !/\.d\.ts$/.test(f));

const cases = [];
for (const c of commits) {
  if (cases.length >= MAX_CASES) break;
  const parent = git(["rev-parse", `${c}^`]).trim();
  if (!parent) continue;

  // 이 커밋이 바꾼 .ts 파일들 (수정만)
  const changed = git(["diff", "--name-status", `${c}^`, c])
    .split("\n").filter(Boolean)
    .map((l) => l.split("\t"))
    .filter(([st, p]) => st === "M" && /\.ts$/.test(p) && !/\.d\.ts$/.test(p))
    .map(([, p]) => p);
  if (changed.length < 2) continue;

  for (const F of changed) {
    if (cases.length >= MAX_CASES) break;
    const base = baseNoExt(F);
    if (GENERIC.has(base)) continue;

    const patch = git(["diff", `${c}^`, c, "--", F]);
    if (!patchTouchesExport(patch)) continue;

    // 같은 커밋의 다른 파일 중 (변경 전 상태에서) F 를 import 하던 것 = 실제 영향받음
    const others = changed.filter((p) => p !== F);
    const affectedRel = [];
    const candIndex = [];
    for (const o of others) {
      const content = git(["show", `${c}^:${o}`]);
      if (!content) continue;
      const idx = extractIndex(`${"autobe"}/${o}`, content);
      candIndex.push(idx);
      if (importsBase(idx, base)) affectedRel.push(`autobe/${o}`);
    }
    if (affectedRel.length === 0) continue; // 측정 가능한 import-영향 없음 → 버림

    // 윈도우 GT: 변경 직후 GEN_WINDOW 커밋 안에서 F 를 import 하며 고쳐진 파일도 '진짜 영향' 으로 인정.
    // 단일-커밋 GT 가 놓치는 "조금 나중에 고친 caller" 를 credit → 진짜 precision 측정용.
    const WINDOW = Number(process.env.GEN_WINDOW ?? 0);
    if (WINDOW > 0) {
      const seen = new Set(affectedRel);
      const later = git(["log", "--reverse", "--pretty=%H", `${c}..HEAD`]).split("\n").filter(Boolean).slice(0, WINDOW);
      for (const L of later) {
        const mod = git(["diff", "--name-status", `${L}^`, L]).split("\n").filter(Boolean)
          .map((x) => x.split("\t"))
          .filter(([s, p]) => s === "M" && /\.ts$/.test(p) && !/\.d\.ts$/.test(p))
          .map(([, p]) => p);
        for (const o of mod) {
          const full = `autobe/${o}`;
          if (o === F || seen.has(full)) continue;
          const content = git(["show", `${L}^:${o}`]) || git(["show", `${L}:${o}`]);
          if (content && importsBase(extractIndex(full, content), base)) {
            seen.add(full);
            affectedRel.push(full);
            candIndex.push(extractIndex(full, content));
          }
        }
      }
    }

    // distractor: 이 커밋과 무관한 파일들 (precision 테스트용). F 를 import 하지 않아야 정상.
    const pool = allTsAtHead.filter((p) => p !== F && !others.includes(p));
    for (let k = 0; k < pool.length && candIndex.length < others.length + DISTRACTORS; k += Math.max(1, Math.floor(pool.length / DISTRACTORS))) {
      const p = pool[k];
      const content = git(["show", `${c}^:${p}`]) || git(["show", `${c}:${p}`]);
      if (content) candIndex.push(extractIndex(`autobe/${p}`, content));
    }

    const removed = patch.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    const added = patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    cases.push({
      name: `${c.slice(0, 8)} · ${F} (export 변경, 영향 ${affectedRel.length})`,
      repo: "autobe",
      file: F,
      diff: patch,
      expectedAffected: affectedRel,
      expectedSeverity: patchSeverity(patch), // breaking 정의(제거/시그니처=high, 추가만=low)
      index: candIndex,
    });
  }
}

writeFileSync(resolve(here, "cases.real.json"), JSON.stringify(cases, null, 2));
console.log(`✅ ${cases.length} 케이스 생성 → scripts/cases.real.json  (repo=${REPO})`);
for (const c of cases) console.log(`   ${c.name}  · 후보 ${c.index.length}개`);

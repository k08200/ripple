// 온톨로지 기회 크기 분석 — "같이 바뀌는 파일(co-change)" 쌍을 정적 신호로 분류한다.
// 질문: 실제 결합 중 (A) 우리 graph 가 이미 잡는 것(import/export-ref/route) vs
//        (B) 온톨로지가 추가로 잡아야 하는 것(정적 엣지 없는 개념/이름 결합) vs
//        (C) 아무 정적 신호도 없는 것(누구도 정적으론 못 잇는) 이 각각 몇 %냐.
//
// 실행: node scripts/analyze-coupling.mjs /path/to/repo [commits]

import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const REPO = process.argv[2];
const SCAN = Number(process.argv[3] ?? 250);
const MAX_FILES_PER_COMMIT = 8; // O(n^2) 가드
const GENERIC = new Set(["index","types","type","common","utils","util","constants","main","mod","config","app","model","models","service","schema","dto","entity","api","client","store","state","data","item","list","user","order","result","response","request","error","base","core"]);

if (!REPO) { console.error("사용법: node scripts/analyze-coupling.mjs /path/to/repo [commits]"); process.exit(1); }

const git = (args) => { try { return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", maxBuffer: 64*1024*1024 }); } catch { return ""; } };
const baseNoExt = (p) => basename(p).replace(/\.[^.]+$/, "");

function extractIndex(text) {
  const t = text.length > 64000 ? text.slice(0, 64000) : text;
  const exports = new Set(), imports = new Set(), refs = new Set(), routes = new Set();
  for (const m of t.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) exports.add(m[1]);
  for (const m of t.matchAll(/\bexport\s*\{([^}]*)\}/g)) for (const n of m[1].split(",")) { const id=n.trim().split(/\s+as\s+/)[0].trim(); if(id) exports.add(id); }
  for (const m of t.matchAll(/\bimport\b[^'"]*['"]([^'"]+)['"]/g)) imports.add(m[1]);
  for (const m of t.matchAll(/\bimport\s*\{([^}]*)\}/g)) for (const n of m[1].split(",")) { const id=n.trim().split(/\s+as\s+/)[0].trim(); if(id) refs.add(id); }
  for (const m of t.matchAll(/['"`](\/[\w/:.-]{2,})['"`]/g)) routes.add(m[1]);
  // 본문에서 등장하는 PascalCase 식별자(개념 후보)
  for (const m of t.matchAll(/\b([A-Z][A-Za-z0-9]{3,})\b/g)) refs.add(m[1]);
  return { exports:[...exports], imports:[...imports], refs:[...refs], routes:[...routes] };
}

const topPkg = (p) => p.split("/").slice(0, 2).join("/"); // 대략의 패키지/경계
const isSpecific = (name) => name.length >= 5 && !GENERIC.has(name.toLowerCase());

function classifyPair(F, fIdx, O, oIdx) {
  const fBase = baseNoExt(F), oBase = baseNoExt(O);
  // A) 정적 링크: 한쪽이 다른쪽 파일을 import, 또는 한쪽 export 를 다른쪽이 ref
  const importLink = oIdx.imports.some((s) => baseNoExt(s) === fBase) || fIdx.imports.some((s) => baseNoExt(s) === oBase);
  const exportRef = fIdx.exports.some((e) => oIdx.refs.includes(e)) || oIdx.exports.some((e) => fIdx.refs.includes(e));
  if (importLink || exportRef) return "static"; // graph 가 잡음
  // A') 라우트 계약 공유 (graph 의 route 매칭이 잡음)
  const sharedRoute = fIdx.routes.some((r) => oIdx.routes.includes(r));
  if (sharedRoute) return "route";
  // B) 정적 엣지 없이 '구체적' 개념 이름만 공유 → 온톨로지 영역(충돌 위험 ↓)
  const sharedSpecific = fIdx.refs.filter((r) => isSpecific(r) && oIdx.refs.includes(r));
  if (sharedSpecific.length > 0) return "concept";
  // C) 아무 신호 없음
  return "none";
}

const commits = git(["log","--pretty=%H",`-n${SCAN}`]).split("\n").filter(Boolean);
const tally = { pairs: 0, static: 0, route: 0, concept: 0, none: 0, crossPkg: 0, crossPkgStatic: 0, crossPkgConcept: 0 };

for (const c of commits) {
  const files = git(["diff","--name-status",`${c}^`,c]).split("\n").filter(Boolean)
    .map((l)=>l.split("\t")).filter(([s,p])=>s==="M" && /\.ts$/.test(p) && !/\.d\.ts$/.test(p)).map(([,p])=>p)
    .slice(0, MAX_FILES_PER_COMMIT);
  if (files.length < 2) continue;
  const idx = {};
  for (const f of files) { const t = git(["show",`${c}^:${f}`]); if (t) idx[f] = extractIndex(t); }
  const present = files.filter((f)=>idx[f]);
  for (let i=0;i<present.length;i++) for (let j=i+1;j<present.length;j++) {
    const F=present[i], O=present[j];
    const kind = classifyPair(F, idx[F], O, idx[O]);
    tally.pairs++; tally[kind]++;
    if (topPkg(F) !== topPkg(O)) {
      tally.crossPkg++;
      if (kind==="static"||kind==="route") tally.crossPkgStatic++;
      if (kind==="concept") tally.crossPkgConcept++;
    }
  }
}

const pct = (n) => tally.pairs ? (100*n/tally.pairs).toFixed(1)+"%" : "0%";
console.log(`\n📊 결합 분석 — ${REPO.split("/").pop()} · 커밋 ${commits.length} · co-change 쌍 ${tally.pairs}\n`);
console.log(`  static (import/export-ref)   ${pct(tally.static)}   ← graph 가 이미 잡음`);
console.log(`  route  (라우트 계약 공유)     ${pct(tally.route)}   ← graph(route) 가 잡음`);
console.log(`  concept(정적엣지X·구체이름만) ${pct(tally.concept)}   ← 온톨로지가 추가로 잡을 영역`);
console.log(`  none   (아무 정적 신호 없음)  ${pct(tally.none)}   ← 누구도 정적으론 못 잇음`);
console.log(`  ─`);
const graphGets = tally.static + tally.route;
console.log(`  → graph 가 이미 커버: ${pct(graphGets)}`);
console.log(`  → 온톨로지 추가 여지: ${pct(tally.concept)}  (단, '이름만' 매칭이라 정밀도 위험)`);
console.log(`  교차-패키지 쌍 ${tally.crossPkg} 중 graph 커버 ${tally.crossPkg?(100*tally.crossPkgStatic/tally.crossPkg).toFixed(0):0}% · concept ${tally.crossPkg?(100*tally.crossPkgConcept/tally.crossPkg).toFixed(0):0}%\n`);

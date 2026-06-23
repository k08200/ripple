// PR 변경 영향 분석 — 저장 기준과 같은 graph 엔진을 PR diff 에 돌려 코멘트 마크다운을 만든다.
// CI(.github/workflows/pr-impact.yml)에서 실행. 로컬 테스트: RIPPLE_REPO=/path BASE=sha HEAD=sha node scripts/pr-impact.mjs
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { GraphProvider } from "../backend/dist/providers/graph.js";

const REPO = process.env.RIPPLE_REPO || ".";
const BASE = process.env.BASE_SHA || "HEAD~1";
const HEAD = process.env.HEAD_SHA || "HEAD";
const REPO_NAME = process.env.REPO_NAME || basename(process.cwd());
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|php|cs|kt|swift|rs|vue|svelte|sql|proto)$/;
const IGNORE = /(^|\/)(node_modules|\.git|dist|build|out|\.next|vendor)\//;
const MAX_FILES = 4000;

const git = (a) => {
  try {
    return execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  } catch {
    return "";
  }
};

function extractIndex(path, text) {
  const t = text.length > 64000 ? text.slice(0, 64000) : text;
  const exports = new Set(), imports = new Set(), refs = new Set();
  for (const m of t.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) exports.add(m[1]);
  for (const m of t.matchAll(/\bexport\s*\{([^}]*)\}/g)) for (const n of m[1].split(",")) { const id = n.trim().split(/\s+as\s+/)[0].trim(); if (id) exports.add(id); }
  for (const m of t.matchAll(/\bimport\b[^'"]*['"]([^'"]+)['"]/g)) imports.add(m[1]);
  for (const m of t.matchAll(/\bimport\s*\{([^}]*)\}/g)) for (const n of m[1].split(",")) { const id = n.trim().split(/\s+as\s+/)[0].trim(); if (id) refs.add(id); }
  for (const m of t.matchAll(/['"`](\/[\w/:.-]{2,})['"`]/g)) refs.add(m[1]);
  return { path, exports: [...exports], imports: [...imports], refs: [...refs] };
}

/** 영향받은 파일에서 바뀐 심볼이 쓰인 첫 줄(file:line + 코드) 찾기. */
function useSites(relPath, symbols) {
  const content = git(["show", `${HEAD}:${relPath}`]);
  if (!content) return [];
  const lines = content.split("\n");
  const sites = [];
  for (const sym of symbols) {
    if (sym.length < 3 || sites.length >= 4) continue;
    const isIdent = /^[A-Za-z_$][\w$]*$/.test(sym);
    const re = isIdent ? new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) : null;
    for (let i = 0; i < lines.length; i++) {
      if (re ? re.test(lines[i]) : lines[i].includes(sym)) {
        sites.push({ line: i + 1, text: lines[i].trim().slice(0, 100) });
        break;
      }
    }
  }
  return sites;
}

const graph = new GraphProvider();

// 1) HEAD 시점 전체 repo 인덱스
const allFiles = git(["ls-tree", "-r", "--name-only", HEAD])
  .split("\n").filter((f) => f && CODE.test(f) && !IGNORE.test(f) && !/\.d\.ts$/.test(f)).slice(0, MAX_FILES);
const knownIndex = [];
for (const f of allFiles) {
  const c = git(["show", `${HEAD}:${f}`]);
  if (c) knownIndex.push(extractIndex(`${REPO_NAME}/${f}`, c));
}
const knownFiles = knownIndex.map((k) => k.path);

// 2) 이 PR 이 바꾼 코드 파일
const changed = git(["diff", "--name-status", BASE, HEAD]).split("\n").filter(Boolean)
  .map((l) => l.split("\t"))
  .filter(([s, p]) => (s === "M" || s === "A") && CODE.test(p) && !IGNORE.test(p) && !/\.d\.ts$/.test(p))
  .map(([, p]) => p);

// 3) 각 변경 파일 분석
const results = [];
for (const f of changed) {
  const diff = git(["diff", BASE, HEAD, "--", f]);
  if (!diff) continue;
  const r = await graph.analyze({ repo: REPO_NAME, file: f, diff, knownFiles, knownIndex });
  if (r.affected.length > 0 && r.severity !== "info") results.push({ file: f, ...r });
}

// 4) 마크다운 코멘트
const ICON = { high: "⚠️", low: "🟡", info: "ℹ️" };
let md = "## 🌊 Ripple — 이 PR의 변경 영향\n\n";
if (results.length === 0) {
  md += "이 PR 의 변경이 다른 코드의 계약(시그니처·스키마·라우트)을 깨지 않습니다. ✅\n";
} else {
  md += `이 PR 은 **${results.length}개 파일**의 변경이 다른 코드에 영향을 줍니다.\n\n`;
  for (const r of results.sort((a, b) => (a.severity === "high" ? -1 : 1))) {
    md += `### ${ICON[r.severity]} \`${r.file}\`\n`;
    for (const d of r.changeDetails.slice(0, 4)) {
      md += `- **\`${d.symbol}\`**${d.note ? ` — ${d.note}` : ""}\n`;
      if (d.before && d.after && d.before !== d.after) md += `  \`\`\`diff\n  - ${d.before}\n  + ${d.after}\n  \`\`\`\n`;
    }
    md += `- 영향받는 곳:\n`;
    for (const a of r.affected.slice(0, 8)) {
      const rel = a.pathHint.startsWith(`${REPO_NAME}/`) ? a.pathHint.slice(REPO_NAME.length + 1) : a.pathHint;
      const sites = useSites(rel, r.changedSymbols);
      const where = sites.length ? sites.map((s) => `\`${rel}:${s.line}\``).join(", ") : `\`${rel}\``;
      md += `  - ${where}${sites[0] ? ` — \`${sites[0].text}\`` : ""}\n`;
    }
    md += "\n";
  }
  md += "\n> _저장 순간 라이브 알림은 Ripple 익스텐션에서. 이 코멘트는 PR 게이트입니다._\n";
}

process.stdout.write(md);

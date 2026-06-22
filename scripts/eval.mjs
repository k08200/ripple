// Phase 0/1 평가 하네스 — provider 별 precision/recall/severity 를 나란히 측정한다.
// 엔진을 바꿀 때마다 이 숫자가 오르는지로만 판단하라 (감 금지).
//
// 실행:
//   node scripts/eval.mjs                 # mock vs graph 비교
//   ANTHROPIC_API_KEY=sk-... node scripts/eval.mjs   # + claude 까지 비교
//
// 케이스 추가: scripts/cases.json 에 너희 팀 repo 실제 변경 + 심볼 인덱스를 넣어라.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { MockProvider } from "../backend/dist/providers/mock.js";
import { GraphProvider } from "../backend/dist/providers/graph.js";
import { ClaudeProvider } from "../backend/dist/providers/claude.js";
import { OpenRouterProvider } from "../backend/dist/providers/openrouter.js";
import { HybridProvider } from "../backend/dist/providers/hybrid.js";

const here = dirname(fileURLToPath(import.meta.url));

// gitignore 된 .env (repo 루트 또는 scripts/) 에서 키를 읽는다. 키는 코드/히스토리에 안 남는다.
for (const envPath of [resolve(here, "../.env"), resolve(here, ".env")]) {
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* .env 없으면 무시 */
  }
}

const casesFile = process.argv[2] ? resolve(process.argv[2]) : resolve(here, "cases.json");
const cases = JSON.parse(readFileSync(casesFile, "utf8"));

const providers = [new MockProvider(), new GraphProvider()];
const orKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
const anKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
// 무료 키 rpm 제한 → LLM 호출을 아끼려 기본은 hybrid(제품 관점)만.
// EVAL_LLM_SOLO=1 이면 LLM 단독 column 도 추가(호출 2배).
const llm = orKey ? new OpenRouterProvider(orKey) : anKey ? new ClaudeProvider(anKey) : null;
if (llm) {
  if (process.env.EVAL_LLM_SOLO === "1") providers.push(llm);
  providers.push(new HybridProvider(llm));
}

/** affected 가 expected 를 가리키나? 느슨한 경로 매칭. */
function matches(hint, expected) {
  const h = String(hint).toLowerCase().trim();
  const e = expected.toLowerCase().trim();
  if (h.length < 3) return false;
  return h === e || h.endsWith(e) || e.endsWith(h) || e.includes(h) || h.includes(e);
}

function scoreCase(predicted, expected) {
  const hitExpected = new Set();
  let fp = 0;
  for (const p of predicted) {
    const matched = expected.filter((e) => matches(p, e));
    if (matched.length > 0) matched.forEach((e) => hitExpected.add(e));
    else fp += 1;
  }
  return { tp: hitExpected.size, fp, fn: expected.length - hitExpected.size };
}

function inputFor(c) {
  return {
    repo: c.repo,
    file: c.file,
    diff: c.diff,
    knownFiles: (c.index ?? []).map((i) => i.path),
    knownIndex: c.index ?? [],
  };
}

async function runProvider(provider) {
  let TP = 0;
  let FP = 0;
  let FN = 0;
  let sevOk = 0;
  let errors = 0;
  const perCase = [];
  for (const c of cases) {
    let result;
    try {
      result = await provider.analyze(inputFor(c));
    } catch (e) {
      errors += 1;
      result = { summary: "", severity: "info", affected: [] }; // 실패 케이스는 빈 결과로
    }
    const predicted = result.affected.map((a) => a.pathHint);
    const s = scoreCase(predicted, c.expectedAffected);
    TP += s.tp;
    FP += s.fp;
    FN += s.fn;
    const sevMatch = result.severity === c.expectedSeverity;
    if (sevMatch) sevOk += 1;
    perCase.push({ name: c.name, predicted, expected: c.expectedAffected, ...s, severity: result.severity, expectedSeverity: c.expectedSeverity, sevMatch });
  }
  const precision = TP + FP === 0 ? 1 : TP / (TP + FP);
  const recall = TP + FN === 0 ? 1 : TP / (TP + FN);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { name: provider.name, precision, recall, f1, sevAcc: sevOk / cases.length, TP, FP, FN, sevOk, errors, perCase };
}

const pct = (x) => (x * 100).toFixed(0).padStart(3) + "%";

async function main() {
  console.log(`\n📏 Ripple 영향분석 평가 — ${casesFile.split("/").pop()} · cases=${cases.length}\n`);
  const runs = [];
  for (const p of providers) runs.push(await runProvider(p));

  // graph 의 케이스별 상세 (현재 엔진이 어디서 이기고 어디서 지는지)
  const graph = runs.find((r) => r.name === "graph");
  if (graph) {
    console.log("graph provider — 케이스별:");
    for (const c of graph.perCase) {
      const mark = c.fp === 0 && c.fn === 0 ? "✅" : "⚠️ ";
      console.log(`${mark} ${c.name}`);
      console.log(`     예측: ${JSON.stringify(c.predicted)}`);
      console.log(`     기대: ${JSON.stringify(c.expected)}  ·  TP=${c.tp} FP=${c.fp} FN=${c.fn} · sev ${c.severity}${c.sevMatch ? "==" : "!="}${c.expectedSeverity}`);
    }
    console.log("");
  }

  // 비교 표
  const W = 9;
  const head = ["provider".padEnd(W), "Precision", "Recall", "F1", "Severity"].join(" │ ");
  console.log(head);
  console.log("─".repeat(head.length));
  for (const r of runs) {
    const row = [
      r.name.padEnd(W),
      pct(r.precision) + `   `,
      pct(r.recall) + ` `,
      pct(r.f1),
      pct(r.sevAcc),
    ].join(" │ ");
    console.log(row + (r.errors ? `   ⚠️ ${r.errors}건 호출 실패` : ""));
  }
  console.log("─".repeat(head.length));
  console.log("게이트: precision ≥ 70% & recall ≥ 50%. graph 는 정적 엣지만 봐서 additive 는 못 잡는다(설계상).\n");
}

main().catch((e) => {
  console.error("평가 오류:", e);
  process.exit(1);
});

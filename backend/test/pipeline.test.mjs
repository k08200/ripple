// 통합 테스트 — 실제 제품 파이프라인을 vscode/ws 글루 없이 그대로 탄다:
//   익스텐션 indexer(.ts) + diff(.ts) → 백엔드 graph 엔진.
// "한 번도 진짜 코드로 안 돌렸다" 구멍을 헤드리스로 최대한 닫는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractIndex } from "../../extension/src/indexer.ts";
import { lineDiff } from "../../extension/src/diff.ts";
import { analyze } from "../dist/analyzer.js";
import { GraphProvider } from "../dist/providers/graph.js";

const graph = new GraphProvider();

// 가짜 워크스페이스: pay.ts(charge export) + client.ts(pay import + charge 사용) + unrelated.ts
const payBefore = `export function charge(amount: number): Promise<void> {\n  return db.save(amount)\n}`;
const payAfter = `export function charge(amount: number, currency: string): Promise<Receipt> {\n  return db.save(amount, currency)\n}`;
const clientSrc = `import { charge } from "./pay"\nexport async function pay() { await charge(100, "USD") }`;
const unrelatedSrc = `import pandas\nexport const NOTHING = 1`;

test("실제 파이프라인: charge 시그니처 변경 저장 → client 영향, unrelated 무관", async () => {
  // 1) 익스텐션이 하듯 실제 indexer 로 워크스페이스 인덱스 빌드
  const knownIndex = [
    extractIndex("repo/src/pay.ts", payAfter),
    extractIndex("repo/src/client.ts", clientSrc),
    extractIndex("repo/ml/unrelated.ts", unrelatedSrc),
  ];

  // 2) 익스텐션이 하듯 실제 diff 로 저장 전/후 diff 생성
  const diff = lineDiff(payBefore, payAfter);
  assert.match(diff, /charge/); // diff 가 실제로 변경을 담음

  // 3) 백엔드 graph 엔진에 그대로 투입
  const { result, usedProvider } = await analyze(graph, {
    repo: "repo",
    file: "src/pay.ts",
    diff,
    knownFiles: knownIndex.map((k) => k.path),
    knownIndex,
  });

  assert.equal(usedProvider, "graph");
  assert.equal(result.severity, "high"); // 시그니처 변경 = 계약 변경
  const hints = result.affected.map((a) => a.pathHint);
  assert.ok(hints.includes("repo/src/client.ts"), "client 가 영향자로 안 잡힘");
  assert.ok(!hints.includes("repo/ml/unrelated.ts"), "unrelated 오탐");
});

test("실제 파이프라인: 내부 구현만 바꾼 저장 → 영향 0건(노이즈 억제)", async () => {
  const before = `export function money(n: number) {\n  return "$" + n.toFixed(2)\n}`;
  const after = `export function money(n: number) {\n  return "$" + n.toLocaleString()\n}`;
  const knownIndex = [
    extractIndex("repo/src/fmt.ts", after),
    extractIndex("repo/src/cart.ts", `import { money } from "./fmt"\nexport const x = money(5)`),
  ];
  const diff = lineDiff(before, after);
  const { result } = await analyze(graph, {
    repo: "repo",
    file: "src/fmt.ts",
    diff,
    knownFiles: knownIndex.map((k) => k.path),
    knownIndex,
  });
  assert.equal(result.severity, "info"); // export 시그니처 안 바뀜
  assert.deepEqual(result.affected, []); // 본문만 바뀐 저장은 아무도 안 찌름
});

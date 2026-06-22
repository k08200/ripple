// graph 엔진 단위 테스트 — 측정으로 확인한 핵심 동작을 못박는다.
// 의존성 0 (node:test 내장). 실행: npm run build -w backend && node --test backend/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphProvider } from "../dist/providers/graph.js";

const graph = new GraphProvider();
const run = (input) => graph.analyze({ knownFiles: [], knownIndex: [], ...input });

const idx = (path, exports = [], imports = [], refs = []) => ({ path, exports, imports, refs });

test("export 시그니처 변경(+/- 양쪽 같은 심볼) → high", async () => {
  const r = await run({
    repo: "api",
    file: "src/pay.ts",
    diff: "@@\n-export function charge(a: number): void\n+export function charge(a: number, b: string): Receipt",
    knownIndex: [idx("web/client.ts", ["pay"], ["./pay"], ["charge"])],
  });
  assert.equal(r.severity, "high");
  assert.ok(r.affected.some((a) => a.pathHint === "web/client.ts"));
});

test("추가만 된 export(additive) → low", async () => {
  const r = await run({
    repo: "api",
    file: "src/pay.ts",
    diff: "@@\n+export const TAX_RATE = 0.1",
    knownIndex: [idx("web/client.ts", [], ["./pay"], [])],
  });
  assert.equal(r.severity, "low");
});

test("내부 구현만 변경(export 그대로) → info, 영향 0건 (info 게이트)", async () => {
  const r = await run({
    repo: "web",
    file: "src/fmt.ts",
    diff: "@@\n export function money(n) {\n-  return n.toFixed(2)\n+  return n.toLocaleString()\n }",
    knownIndex: [idx("web/cart.ts", [], ["./fmt"], ["money"])], // import 해도
  });
  assert.equal(r.severity, "info");
  assert.deepEqual(r.affected, []); // info 면 무조건 빈 배열
});

test("importHit: 바뀐 심볼을 본문에서 써서 refs 엔 없어도, import 만으로 영향 잡힘", async () => {
  const r = await run({
    repo: "api",
    file: "src/order.ts",
    diff: "@@\n-export interface Order { id: string; legacy: string }\n+export interface Order { id: string }",
    knownIndex: [idx("web/checkout.ts", ["checkout"], ["../api/order"], [])], // refs 비어도
  });
  assert.equal(r.severity, "high");
  assert.ok(r.affected.some((a) => a.pathHint === "web/checkout.ts"));
});

test("라우트 경로 변경 → high, 그 경로를 참조하는 클라이언트가 영향", async () => {
  const r = await run({
    repo: "api",
    file: "src/routes/auth.ts",
    diff: "@@\n-router.post('/login', h)\n+router.post('/v2/login', h)",
    knownIndex: [idx("web/auth-client.ts", ["login"], ["axios"], ["/login"])],
  });
  assert.equal(r.severity, "high");
  assert.ok(r.affected.some((a) => a.pathHint === "web/auth-client.ts"));
});

test("무관한 파일(import 도 ref 도 없음)은 영향 아님 (오탐 없음)", async () => {
  const r = await run({
    repo: "api",
    file: "src/pay.ts",
    diff: "@@\n-export function charge(): void\n+export function charge(x: number): void",
    knownIndex: [idx("ml/train.py", [], ["pandas"], [])],
  });
  assert.equal(r.affected.length, 0);
});

test("refHit 가 importHit 보다 먼저 정렬됨 (확신도 순)", async () => {
  const r = await run({
    repo: "shared",
    file: "src/types/order.ts",
    diff: "@@\n-export interface Order { id: string; legacy: string }\n+export interface Order { id: string }",
    knownIndex: [
      idx("a/only-imports.ts", [], ["shared/types/order"], []), // importHit (파일 import)
      idx("b/refs-symbol.ts", [], ["x"], ["Order"]), // refHit (바뀐 심볼 Order 직접 참조)
    ],
  });
  assert.equal(r.affected[0].pathHint, "b/refs-symbol.ts"); // refHit 먼저
});

test("고-팬아웃: 60개 importer 여도 캡(50)에서 잘리되 안 죽음", async () => {
  const many = Array.from({ length: 60 }, (_, i) => idx(`f${i}.ts`, [], ["./order"], []));
  const r = await run({
    repo: "shared",
    file: "src/order.ts",
    diff: "@@\n-export interface Order { id: string; legacy: string }\n+export interface Order { id: string }",
    knownIndex: many,
  });
  assert.equal(r.severity, "high");
  assert.equal(r.affected.length, 50); // MAX_AFFECTED
});

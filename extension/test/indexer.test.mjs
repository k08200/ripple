// 익스텐션이 실제로 쓰는 심볼 인덱서 단위 테스트 (실제 코드 = 백엔드 graph 가 의존).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractIndex } from "../src/indexer.ts";

test("export 선언들을 exports 로 뽑는다", () => {
  const i = extractIndex("a.ts", [
    "export function foo() {}",
    "export const BAR = 1",
    "export class Baz {}",
    "export interface IQux {}",
    "export type T = number",
    "export enum E { A }",
  ].join("\n"));
  for (const name of ["foo", "BAR", "Baz", "IQux", "T", "E"]) {
    assert.ok(i.exports.includes(name), `${name} 누락`);
  }
});

test("export { a, b as c } 리스트도 exports 로", () => {
  const i = extractIndex("a.ts", "export { alpha, beta as gamma } from './x'");
  assert.ok(i.exports.includes("alpha"));
  assert.ok(i.exports.includes("beta")); // as 앞쪽 이름
});

test("import / require / python from 을 imports 로", () => {
  const i = extractIndex("a.ts", [
    "import { x } from './mod-a'",
    "import y from \"../mod-b\"",
    "const z = require('./mod-c')",
    "from pkg.mod import thing",
  ].join("\n"));
  assert.ok(i.imports.includes("./mod-a"));
  assert.ok(i.imports.includes("../mod-b"));
  assert.ok(i.imports.includes("./mod-c"));
  assert.ok(i.imports.includes("pkg.mod"));
});

test("named import 심볼과 라우트 경로를 refs 로 (영향 역매칭용)", () => {
  const i = extractIndex("a.ts", [
    "import { charge, refund } from './pay'",
    "router.post('/v2/login', h)",
  ].join("\n"));
  assert.ok(i.refs.includes("charge"));
  assert.ok(i.refs.includes("refund"));
  assert.ok(i.refs.includes("/v2/login"));
});

test("path 는 그대로 보존된다", () => {
  const i = extractIndex("web/src/cart.ts", "export const x = 1");
  assert.equal(i.path, "web/src/cart.ts");
});

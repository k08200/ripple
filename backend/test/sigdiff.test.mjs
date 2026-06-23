// 시그니처 변경 묘사 테스트 — "어떻게"를 사람 말로 정확히.
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSignatureChange } from "../dist/sigdiff.js";

test("인자 추가 + 반환 타입 변경", () => {
  const d = describeSignatureChange(
    "export function charge(amount: number): Promise<void>",
    "export function charge(amount: number, currency: string): Promise<Receipt>",
  );
  assert.equal(d, "currency 인자 추가 · 반환 Promise<void> → Promise<Receipt>");
});

test("인자 제거", () => {
  const d = describeSignatureChange("function f(a: number, b: string): void", "function f(a: number): void");
  assert.equal(d, "b 인자 제거");
});

test("반환 타입만 변경", () => {
  const d = describeSignatureChange("function g(x: number): number", "function g(x: number): string");
  assert.equal(d, "반환 number → string");
});

test("바뀐 게 없으면 undefined", () => {
  assert.equal(describeSignatureChange("function h(a: number): void", "function h(a: number): void"), undefined);
});

test("인자 이름 유지·타입만 바뀌면 인자 추가/제거 아님", () => {
  // a:number → a:string : 이름 a 동일이라 추가/제거 없음, 반환도 동일 → undefined
  assert.equal(describeSignatureChange("function k(a: number): void", "function k(a: string): void"), undefined);
});

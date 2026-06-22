// 익스텐션이 실제로 쓰는 diff 로직 단위 테스트 (Node 24 type-strip 으로 .ts 직접 import).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineDiff } from "../src/diff.ts";

test("동일 텍스트 → 빈 diff (보낼 게 없음)", () => {
  assert.equal(lineDiff("a\nb\nc", "a\nb\nc"), "");
});

test("라인 추가 → +라인 포함", () => {
  const d = lineDiff("a\nb", "a\nb\nc");
  assert.match(d, /\+c/);
});

test("라인 삭제 → -라인 포함", () => {
  const d = lineDiff("a\nb\nc", "a\nc");
  assert.match(d, /-b/);
});

test("멀리 떨어진 무변경 라인은 @@ 로 접힌다", () => {
  const before = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n");
  const after = before.replace("line25", "line25_changed");
  const d = lineDiff(before, after);
  assert.match(d, /@@/); // 변경 주변만 남고 나머지 접힘
  assert.match(d, /\+line25_changed/);
  assert.ok(!d.includes("line0")); // 멀리 떨어진 건 제외
});

test("빈 → 내용: 전부 추가", () => {
  const d = lineDiff("", "x\ny");
  assert.match(d, /\+x/);
  assert.match(d, /\+y/);
});

test("시그니처 한 줄 교체 → -옛 +새", () => {
  const d = lineDiff(
    "export function charge(a: number): void {}",
    "export function charge(a: number, b: string): Receipt {}",
  );
  assert.match(d, /-export function charge\(a: number\): void/);
  assert.match(d, /\+export function charge\(a: number, b: string\): Receipt/);
});

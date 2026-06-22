// 세션 중 인덱스 갱신 테스트 — 저장 때마다 그 파일 인덱스가 최신으로 교체되는지.
import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertIndex, removeIndex } from "../dist/index-store.js";

const kf = (path, exports = []) => ({ path, exports, imports: [], refs: [] });

test("새 경로는 추가된다", () => {
  const next = upsertIndex([kf("a.ts")], kf("b.ts", ["foo"]));
  assert.equal(next.length, 2);
  assert.deepEqual(next.find((k) => k.path === "b.ts").exports, ["foo"]);
});

test("기존 경로는 새 인덱스로 교체된다 (낡은 export 사라짐)", () => {
  const before = [kf("pay.ts", ["charge"]), kf("cart.ts")];
  const next = upsertIndex(before, kf("pay.ts", ["charge", "refund"])); // refund 추가됨
  assert.equal(next.length, 2); // 중복 안 생김
  assert.deepEqual(next.find((k) => k.path === "pay.ts").exports, ["charge", "refund"]);
});

test("불변: 원본 배열은 안 바뀐다", () => {
  const before = [kf("a.ts")];
  const next = upsertIndex(before, kf("a.ts", ["x"]));
  assert.equal(before.length, 1);
  assert.deepEqual(before[0].exports, []); // 원본 그대로
  assert.notEqual(before, next);
});

test("removeIndex: 삭제된 파일은 인덱스에서 빠진다 (불변)", () => {
  const before = [kf("a.ts"), kf("b.ts"), kf("c.ts")];
  const next = removeIndex(before, "b.ts");
  assert.deepEqual(next.map((k) => k.path), ["a.ts", "c.ts"]);
  assert.equal(before.length, 3); // 원본 보존
});

test("removeIndex: 없는 경로면 그대로", () => {
  const before = [kf("a.ts")];
  assert.deepEqual(removeIndex(before, "z.ts").map((k) => k.path), ["a.ts"]);
});

// 세션 중 인덱스 갱신 테스트 — 저장 때마다 그 파일 인덱스가 최신으로 교체되는지.
import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertIndex } from "../dist/index-store.js";

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

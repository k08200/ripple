// 오프라인 백필 매칭 테스트 — 늦게 접속한 사람에게 "놓친 변경" 을 정확히 골라주는지.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathMatches, impactTouches } from "../dist/match.js";

const impact = (affected) => ({
  type: "impact",
  id: "x",
  author: "alice",
  repo: "api",
  file: "pay.ts",
  summary: "",
  severity: "high",
  affected: affected.map((pathHint) => ({ pathHint, reason: "" })),
  ts: 0,
});

test("pathMatches: 정확/접미/부분 일치", () => {
  assert.ok(pathMatches("web/src/client.ts", "web/src/client.ts")); // 동일
  assert.ok(pathMatches("client.ts", "web/src/client.ts")); // hint 가 끝부분
  assert.ok(pathMatches("web/src/client.ts", "src/client.ts")); // 파일이 hint 의 끝부분
});

test("pathMatches: 너무 짧은 hint 는 무시 (오탐 방지)", () => {
  assert.equal(pathMatches("a.ts", "web/src/cart.ts"), false); // 4자 미만 비교 회피
});

test("impactTouches: 내 파일을 가리키는 영향이면 true", () => {
  const files = new Set(["web/src/payment-client.ts", "web/src/cart.ts"]);
  assert.ok(impactTouches(impact(["web/src/payment-client.ts"]), files));
});

test("impactTouches: 무관한 영향이면 false (백필 노이즈 없음)", () => {
  const files = new Set(["ml/train.py", "ml/model.py"]);
  assert.equal(impactTouches(impact(["web/src/payment-client.ts"]), files), false);
});

test("impactTouches: affected 비어 있으면 false", () => {
  assert.equal(impactTouches(impact([]), new Set(["web/src/x.ts"])), false);
});

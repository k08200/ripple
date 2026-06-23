// 사용처 탐색 단위 테스트 — "어디서 어떻게 깨지나"의 핵심 로직.
import { test } from "node:test";
import assert from "node:assert/strict";
import { locateUseSites } from "../src/usesite.ts";

const FILE = [
  "import { charge } from './pay'",
  "",
  "export async function pay() {",
  "  const r = await charge(100)",
  "  return r",
  "}",
].join("\n").split("\n");

test("식별자의 모든 사용 라인을 찾는다 (1-based)", () => {
  const sites = locateUseSites(FILE, ["charge"]);
  assert.deepEqual(sites.map((s) => s.line), [1, 4]); // import 줄 + 호출 줄
  assert.match(sites[0].text, /charge/);
});

test("단어경계 매칭 — 부분문자열 오탐 없음", () => {
  const lines = ["const recharged = 1", "doCharge()"];
  assert.deepEqual(locateUseSites(lines, ["charge"]), []); // recharged/doCharge 는 charge 가 아님
});

test("라우트(슬래시 시작)는 부분일치로 찾는다", () => {
  const lines = ["fetch('/v2/login')", "x"];
  const sites = locateUseSites(lines, ["/v2/login"]);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].line, 1);
});

test("심볼당 여러 사용처를 찾되 per-symbol 캡", () => {
  const lines = ["a Order", "b Order", "c Order", "d Item"];
  const sites = locateUseSites(lines, ["Order", "Item"], 2, 8); // Order 2개(캡) + Item 1개
  assert.deepEqual(sites.map((s) => s.line), [1, 2, 4]);
});

test("total 캡이 per-symbol 보다 우선", () => {
  const lines = ["a Order", "b Order", "c Item", "d Item"];
  const sites = locateUseSites(lines, ["Order", "Item"], 3, 3);
  assert.equal(sites.length, 3); // 총 3개에서 멈춤
});

test("3자 미만 심볼은 무시 (노이즈 방지)", () => {
  assert.deepEqual(locateUseSites(["id = 1"], ["id"]), []);
});

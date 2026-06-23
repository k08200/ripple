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

test("식별자의 첫 사용 라인을 찾는다 (1-based)", () => {
  const sites = locateUseSites(FILE, ["charge"]);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].line, 1); // import 줄이 첫 등장
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

test("심볼당 하나, 최대 개수 제한", () => {
  const lines = ["a Order", "b Order", "c Item", "d Item"];
  const sites = locateUseSites(lines, ["Order", "Item"], 4);
  assert.equal(sites.length, 2); // Order 첫 줄 + Item 첫 줄
  assert.deepEqual(sites.map((s) => s.line), [1, 3]);
});

test("3자 미만 심볼은 무시 (노이즈 방지)", () => {
  assert.deepEqual(locateUseSites(["id = 1"], ["id"]), []);
});

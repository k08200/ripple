import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalUrl, parsePort, shouldAutoStart } from "../src/autostart.ts";

test("로컬 주소 판별", () => {
  assert.ok(isLocalUrl("ws://localhost:7077"));
  assert.ok(isLocalUrl("ws://127.0.0.1:7077"));
  assert.ok(isLocalUrl("ws://localhost"));
  assert.equal(isLocalUrl("ws://brain.team.com:7077"), false);
  assert.equal(isLocalUrl("wss://ripple.example.com"), false);
});

test("포트 파싱 (없으면 기본 7077)", () => {
  assert.equal(parsePort("ws://localhost:7077"), 7077);
  assert.equal(parsePort("ws://localhost:9000/"), 9000);
  assert.equal(parsePort("ws://localhost"), 7077);
});

test("자동기동: 로컬 + 설정 on 일 때만", () => {
  assert.equal(shouldAutoStart("ws://localhost:7077", true), true);
  assert.equal(shouldAutoStart("ws://localhost:7077", false), false); // 끔
  assert.equal(shouldAutoStart("wss://brain.team.com", true), false); // 팀 모드(원격)
});

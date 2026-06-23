import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReply } from "../src/discovery.ts";

test("ripple 응답에서 포트 추출", () => {
  assert.equal(parseReply(JSON.stringify({ ripple: 1, port: 7077 })), 7077);
});

test("ripple 응답 아니면 undefined", () => {
  assert.equal(parseReply(JSON.stringify({ port: 7077 })), undefined); // ripple 플래그 없음
  assert.equal(parseReply("not json"), undefined);
  assert.equal(parseReply(JSON.stringify({ ripple: 1 })), undefined); // 포트 없음
});

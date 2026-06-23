// 발견 프로토콜 단위 테스트 + 실제 UDP 왕복(응답기 ↔ 질의).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as dgram from "node:dgram";
import { isQuery, makeReply, QUERY, DISCOVERY_PORT, startResponder } from "../dist/discovery.js";

test("질의 판별 / 응답 포맷", () => {
  assert.ok(isQuery("RIPPLE_DISCOVER?"));
  assert.equal(isQuery("nope"), false);
  assert.deepEqual(JSON.parse(makeReply(7077)), { ripple: 1, port: 7077 });
});

test("실제 UDP: 응답기에 질의하면 ws 포트로 응답한다", async () => {
  const responder = startResponder(7077);
  await new Promise((r) => setTimeout(r, 150)); // bind 대기

  const reply = await new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.on("message", (buf) => {
      resolve(JSON.parse(buf.toString()));
      sock.close();
    });
    sock.bind(() => sock.send(QUERY, DISCOVERY_PORT, "127.0.0.1"));
    setTimeout(() => {
      try { sock.close(); } catch { /* noop */ }
      resolve(null);
    }, 1000);
  });

  responder.close();
  assert.ok(reply, "응답을 못 받음");
  assert.equal(reply.port, 7077);
});

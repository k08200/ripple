import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalUrl, parsePort, shouldAutoStart, electionDelayMs, ELECTION_MAX_MS } from "../src/autostart.ts";

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

test("host 선출 대기: 주입한 난수에 비례하고 [0, MAX) 안에 든다", () => {
  // 결정적(난수 주입) — 동시 이탈 시 각자 다른 시간을 뽑아 한 명만 host 가 되게 하는 핵심.
  assert.equal(electionDelayMs(() => 0), 0); // 최소 = 즉시(이 클라가 host 후보 1순위)
  assert.equal(electionDelayMs(() => 0.5), Math.floor(0.5 * ELECTION_MAX_MS));
  assert.ok(electionDelayMs(() => 0.999999) < ELECTION_MAX_MS); // 상한 미만(=즉시 self-start 와 안 겹침)
  // 기본 인자(Math.random)도 항상 범위 안.
  for (let i = 0; i < 100; i++) {
    const d = electionDelayMs();
    assert.ok(d >= 0 && d < ELECTION_MAX_MS, `범위 밖: ${d}`);
  }
});

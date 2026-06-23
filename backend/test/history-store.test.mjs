// 히스토리 영속 테스트 — 재시작해도 백필 유지(저장→로드 라운드트립), team 태그 포함.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, writeFileSync } from "node:fs";
import { loadHistory, saveHistory } from "../dist/history-store.js";

const tmp = (n) => join(tmpdir(), `ripple-hist-${n}.json`);
const impact = (id) => ({ type: "impact", id, author: "a", repo: "r", file: "f", summary: "", severity: "high", affected: [], changedSymbols: [], changeDetails: [], ts: 0 });
const entry = (id, team = "t1") => ({ team, impact: impact(id) });

test("save → load 라운드트립 (team 포함)", () => {
  const p = tmp("rt");
  saveHistory(p, [entry("1"), entry("2", "t2")]);
  const loaded = loadHistory(p, 50);
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded.map((e) => e.impact.id), ["1", "2"]);
  assert.equal(loaded[1].team, "t2");
  rmSync(p, { force: true });
});

test("max 초과는 최근 것만", () => {
  const p = tmp("max");
  saveHistory(p, [entry("1"), entry("2"), entry("3")]);
  assert.deepEqual(loadHistory(p, 2).map((e) => e.impact.id), ["2", "3"]);
  rmSync(p, { force: true });
});

test("없는 파일 → 빈 히스토리", () => {
  assert.deepEqual(loadHistory(tmp("nope-xyz"), 50), []);
});

test("깨진 파일 → 빈 히스토리", () => {
  const p = tmp("broken");
  writeFileSync(p, "{ not json");
  assert.deepEqual(loadHistory(p, 50), []);
  rmSync(p, { force: true });
});

test("team 없거나 impact 아닌 잡것은 걸러진다", () => {
  const p = tmp("dirty");
  writeFileSync(p, JSON.stringify([entry("1"), { impact: impact("2") }, { team: "t", impact: { type: "junk" } }, null]));
  assert.deepEqual(loadHistory(p, 50).map((e) => e.impact.id), ["1"]);
  rmSync(p, { force: true });
});

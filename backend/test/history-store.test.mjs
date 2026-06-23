// 히스토리 영속 테스트 — 재시작해도 백필이 유지되는지(저장→로드 라운드트립).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, writeFileSync } from "node:fs";
import { loadHistory, saveHistory } from "../dist/history-store.js";

const tmp = (n) => join(tmpdir(), `ripple-hist-${n}.json`);
const impact = (id) => ({ type: "impact", id, author: "a", repo: "r", file: "f", summary: "", severity: "high", affected: [], ts: 0 });

test("save → load 라운드트립", () => {
  const p = tmp("rt");
  saveHistory(p, [impact("1"), impact("2")]);
  const loaded = loadHistory(p, 50);
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded.map((m) => m.id), ["1", "2"]);
  rmSync(p, { force: true });
});

test("max 초과는 최근 것만 (꼬리 유지)", () => {
  const p = tmp("max");
  saveHistory(p, [impact("1"), impact("2"), impact("3")]);
  const loaded = loadHistory(p, 2);
  assert.deepEqual(loaded.map((m) => m.id), ["2", "3"]);
  rmSync(p, { force: true });
});

test("없는 파일 → 빈 히스토리 (조용히 폴백)", () => {
  assert.deepEqual(loadHistory(tmp("nope-xyz"), 50), []);
});

test("깨진 파일 → 빈 히스토리", () => {
  const p = tmp("broken");
  writeFileSync(p, "{ this is not json");
  assert.deepEqual(loadHistory(p, 50), []);
  rmSync(p, { force: true });
});

test("impact 아닌 잡것은 걸러진다", () => {
  const p = tmp("dirty");
  writeFileSync(p, JSON.stringify([impact("1"), { type: "junk" }, null]));
  const loaded = loadHistory(p, 50);
  assert.deepEqual(loaded.map((m) => m.id), ["1"]);
  rmSync(p, { force: true });
});

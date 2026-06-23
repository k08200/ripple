// 두 protocol.ts(백엔드/익스텐션)는 손으로 미러링한다 — 드리프트 시 사일런트 깨짐.
// 이 테스트가 인터페이스 이름 + 필드(이름·optional)의 일치를 기계로 강제한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const backend = readFileSync(resolve(here, "../src/protocol.ts"), "utf8");
const extension = readFileSync(resolve(here, "../../extension/src/protocol.ts"), "utf8");

/** 주석 제거 후 `export interface X { ... }` 를 파싱해 이름→필드시그니처(name+?) 맵으로. */
function parseInterfaces(src) {
  const clean = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map();
  const re = /export\s+interface\s+(\w+)\s*\{([^}]*)\}/g;
  for (const m of clean.matchAll(re)) {
    const fields = new Set();
    for (const line of m[2].split(/[\n;]/)) {
      const f = /^\s*(\w+)(\??)\s*:/.exec(line);
      if (f) fields.add(f[1] + f[2]); // 예: "replay?" / "userId"
    }
    out.set(m[1], fields);
  }
  return out;
}

/** export type 별칭 이름 집합 (Severity / ClientMessage / ServerMessage 등). */
function typeNames(src) {
  const clean = src.replace(/\/\/.*$/gm, "");
  return new Set([...clean.matchAll(/export\s+type\s+(\w+)\b/g)].map((m) => m[1]));
}

test("두 protocol 의 인터페이스 집합이 동일하다", () => {
  const a = parseInterfaces(backend);
  const b = parseInterfaces(extension);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), "인터페이스 이름 불일치");
});

test("각 인터페이스의 필드(이름+optional)가 동일하다", () => {
  const a = parseInterfaces(backend);
  const b = parseInterfaces(extension);
  for (const [name, fields] of a) {
    assert.deepEqual(
      [...fields].sort(),
      [...(b.get(name) ?? new Set())].sort(),
      `${name} 필드 드리프트`,
    );
  }
});

test("export type 별칭 집합이 동일하다", () => {
  assert.deepEqual([...typeNames(backend)].sort(), [...typeNames(extension)].sort());
});

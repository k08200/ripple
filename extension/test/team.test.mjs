import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTeam } from "../src/team.ts";

test("https / ssh / git 형식이 같은 repo면 같은 room", () => {
  const a = normalizeTeam("https://github.com/k08200/ripple.git");
  const b = normalizeTeam("git@github.com:k08200/ripple.git");
  const c = normalizeTeam("ssh://git@github.com/k08200/ripple");
  assert.equal(a, "github.com/k08200/ripple");
  assert.equal(a, b);
  assert.equal(a, c);
});

test("다른 repo 는 다른 room", () => {
  assert.notEqual(
    normalizeTeam("https://github.com/team/proj-a.git"),
    normalizeTeam("https://github.com/team/proj-b.git"),
  );
});

test("대소문자/끝슬래시 무시", () => {
  assert.equal(normalizeTeam("https://GitHub.com/A/B/"), "github.com/a/b");
});

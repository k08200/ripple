import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOwnerRepo } from "../src/pr-watch.ts";

test("github 원격에서 owner/repo 추출 (https/ssh/.git)", () => {
  assert.deepEqual(parseOwnerRepo("https://github.com/k08200/ripple.git"), { owner: "k08200", repo: "ripple" });
  assert.deepEqual(parseOwnerRepo("git@github.com:k08200/klorn.git"), { owner: "k08200", repo: "klorn" });
  assert.deepEqual(parseOwnerRepo("https://github.com/Acme/My-Repo"), { owner: "Acme", repo: "My-Repo" });
});

test("github 아니면 undefined", () => {
  assert.equal(parseOwnerRepo("https://gitlab.com/a/b.git"), undefined);
  assert.equal(parseOwnerRepo(""), undefined);
});

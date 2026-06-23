// WS 통합 테스트 — 실제 서버 프로세스를 띄워 register→change→impact 와 replay 백필을 검증.
// sim(수동)만 있던 디스패치 경로를 자동 테스트로 못박는다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(here, "../dist/server.js");
const PORT = 7099;
const WS_URL = `ws://localhost:${PORT}`;
const HIST = join(tmpdir(), "ripple-itest-history.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let proc;

before(async () => {
  rmSync(HIST, { force: true });
  proc = spawn("node", [SERVER], {
    env: { ...process.env, PORT: String(PORT), RIPPLE_HISTORY: HIST, RIPPLE_PROVIDER: "graph", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error("server failed to start");
});

after(() => {
  proc?.kill();
  rmSync(HIST, { force: true });
});

function client(userId, repo, index) {
  const ws = new WebSocket(WS_URL);
  const inbox = [];
  ws.on("message", (d) => inbox.push(JSON.parse(d.toString())));
  const ready = new Promise((res) =>
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "register", userId, repo, files: index.map((i) => i.path), index }));
      res();
    }),
  );
  return {
    inbox,
    ready,
    save: (file, diff, idx) => ws.send(JSON.stringify({ type: "change", userId, repo, file, diff, index: idx })),
    close: () => ws.close(),
  };
}

const payIdx = { path: "src/pay.ts", exports: ["charge"], imports: [], refs: [] };
const clientIdx = { path: "src/client.ts", exports: ["pay"], imports: ["api/pay"], refs: ["charge"] };
const SIG_DIFF = "@@\n-export function charge(a: number): void\n+export function charge(a: number, b: string): Receipt";

test("register → change → 영향받는 클라에 impact 브로드캐스트", async () => {
  const alice = client("alice", "api", [payIdx]);
  const bob = client("bob", "web", [clientIdx]);
  await Promise.all([alice.ready, bob.ready]);
  await sleep(150);

  alice.save("src/pay.ts", SIG_DIFF, payIdx);
  await sleep(600);

  const impact = bob.inbox.find((m) => m.type === "impact");
  assert.ok(impact, "bob 이 impact 를 못 받음");
  assert.equal(impact.severity, "high");
  assert.ok(impact.affected.some((a) => a.pathHint.includes("client.ts")), "client.ts 가 영향자로 안 잡힘");
  alice.close();
  bob.close();
  await sleep(100);
});

test("늦게 접속한 클라가 놓친 영향을 replay 로 백필받는다", async () => {
  // 1) 아무도 안 보는 사이 carol 이 계약 변경 저장
  const carol = client("carol", "api", [payIdx]);
  await carol.ready;
  await sleep(150);
  carol.save("src/pay.ts", SIG_DIFF, payIdx);
  await sleep(500);

  // 2) 그 뒤 dave 가 뒤늦게 접속 — pay 를 import
  const dave = client("dave", "web", [clientIdx]);
  await dave.ready;
  await sleep(500);

  const replay = dave.inbox.find((m) => m.type === "impact" && m.replay === true);
  assert.ok(replay, "dave 가 replay 백필을 못 받음");
  assert.ok(replay.affected.some((a) => a.pathHint.includes("client.ts")));
  carol.close();
  dave.close();
  await sleep(100);
});

test("무관한 클라는 영향 안 받음 (오탐 없음)", async () => {
  const eve = client("eve", "api", [payIdx]);
  const frank = client("frank", "ml", [{ path: "train.py", exports: [], imports: ["pandas"], refs: [] }]);
  await Promise.all([eve.ready, frank.ready]);
  await sleep(150);

  eve.save("src/pay.ts", SIG_DIFF, payIdx);
  await sleep(600);

  const impact = frank.inbox.find((m) => m.type === "impact" && !m.replay);
  // frank 도 브로드캐스트는 받지만, 그의 파일(train.py)은 affected 에 없어야 한다.
  if (impact) assert.ok(!impact.affected.some((a) => a.pathHint.includes("train.py")), "train.py 오탐");
  eve.close();
  frank.close();
  await sleep(100);
});

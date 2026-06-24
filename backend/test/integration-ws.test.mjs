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

function client(userId, repo, index, team) {
  const ws = new WebSocket(WS_URL);
  const inbox = [];
  ws.on("message", (d) => inbox.push(JSON.parse(d.toString())));
  const ready = new Promise((res) =>
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "register", userId, repo, files: index.map((i) => i.path), index, team }));
      res();
    }),
  );
  return {
    inbox,
    ready,
    save: (file, diff, idx) => ws.send(JSON.stringify({ type: "change", userId, repo, file, diff, index: idx })),
    savePr: (file, diff, idx, pr) => ws.send(JSON.stringify({ type: "change", userId, repo, file, diff, index: idx, source: "pr", pr })),
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
  // 무엇이 바뀌었나(changedSymbols)가 와이어로 전달되는지 — 수신자 use-site 탐색의 입력.
  assert.ok(impact.changedSymbols.includes("charge"), "changedSymbols 에 charge 없음");
  const detail = impact.changeDetails.find((d) => d.symbol === "charge");
  assert.ok(detail?.before && detail?.after, "charge before→after 가 와이어로 안 옴");
  alice.close();
  bob.close();
  await sleep(100);
});

test("혼자(단일 클라): 자기 변경의 영향을 자기도 받는다 — 호출부 리마인더의 토대", async () => {
  // 시나리오 3: 팀원 없이 혼자 작업해도 동작해야 한다.
  // 한 명이 pay.ts 와 client.ts 를 모두 가진 채 pay.ts 의 계약을 바꾸면,
  // 서버는 작성자 제외 없이 되돌려주고 affected 에 자기 client.ts 가 잡혀야 한다.
  const solo = client("solo", "api", [payIdx, clientIdx]);
  await solo.ready;
  await sleep(150);

  solo.save("src/pay.ts", SIG_DIFF, payIdx);
  await sleep(600);

  const impact = solo.inbox.find((m) => m.type === "impact" && !m.replay);
  assert.ok(impact, "혼자일 때 작성자가 자기 impact 를 못 받음 (작성자 제외돼버림)");
  assert.equal(impact.author, "solo");
  assert.ok(
    impact.affected.some((a) => a.pathHint.includes("client.ts")),
    "자기 다른 파일(client.ts)이 영향자로 안 잡힘",
  );
  assert.ok(impact.changedSymbols.includes("charge"), "changedSymbols 에 charge 없음");
  solo.close();
  await sleep(100);
});

test("큰 모노레포 register(인덱스 >512KB)도 수락된다 — payload 거부로 먹통되던 회귀 방지", async () => {
  // 실전 버그: 인바운드 상한이 512KB 였을 때, 큰 repo(수천 파일)의 인덱스 동봉 register 가
  // 프레임 크기 초과로 거부 → 무한 재연결만 돌고 그 창은 영구 먹통이었다. 상한을 넉넉히
  // 올린 뒤로 수락돼야 한다. presence 에 자기가 잡히면 = register 성공(연결 안 끊김).
  const big = [];
  for (let i = 0; i < 3000; i++) {
    big.push({
      path: `packages/service/src/modules/feature${i}/handlers/file${i}.ts`,
      exports: [`createHandler${i}`, `updateHandler${i}`, `deleteHandler${i}`, `listHandler${i}`, `validateInput${i}`, `serializeOutput${i}`],
      imports: [`../../../shared/utils/helper${i}`, `../../../core/base/foundation${i}`, `../types/contracts${i}`],
      refs: [`SharedSymbolOne${i}`, `SharedSymbolTwo${i}`, `SharedSymbolThree${i}`, `SharedSymbolFour${i}`],
    });
  }
  assert.ok(JSON.stringify(big).length > 512 * 1024, `테스트 전제: 인덱스가 512KB 를 넘어야 함 (현재 ${Math.round(JSON.stringify(big).length / 1024)}KB)`);

  const big1 = client("big1", "mono", big, "team-big");
  await big1.ready;
  await sleep(500);

  const pres = big1.inbox.find((m) => m.type === "presence" && m.peers.some((p) => p.userId === "big1"));
  assert.ok(pres, "큰 register 가 거부됨 — payload 상한 회귀 (클라가 먹통)");
  big1.close();
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

test("PR 출처: 영향이 source=pr + pr 메타로 오고, 같은 PR head 는 한 번만 분석된다", async () => {
  const alice = client("alice", "api", [payIdx]);
  const bob = client("bob", "web", [clientIdx]);
  await Promise.all([alice.ready, bob.ready]);
  await sleep(150);

  const pr = { number: 42, url: "https://github.com/x/y/pull/42", title: "sig change", head: "abc123" };
  alice.savePr("src/pay.ts", SIG_DIFF, payIdx, pr);
  await sleep(500);

  const prImpacts = bob.inbox.filter((m) => m.type === "impact" && m.source === "pr");
  assert.equal(prImpacts.length, 1, "PR impact 가 정확히 1건이어야 함");
  assert.equal(prImpacts[0].pr.number, 42, "pr 메타 전달 안 됨");
  assert.ok(prImpacts[0].affected.some((a) => a.pathHint.includes("client.ts")));

  // 같은 PR(같은 head)·같은 파일 재전송 → 중복 분석 안 함 (여러 명 폴링 대비)
  alice.savePr("src/pay.ts", SIG_DIFF, payIdx, pr);
  await sleep(500);
  assert.equal(
    bob.inbox.filter((m) => m.type === "impact" && m.source === "pr").length,
    1,
    "같은 PR head 가 중복 분석됨(dedup 실패)",
  );
  alice.close();
  bob.close();
  await sleep(100);
});

test("팀 격리: 다른 team 은 서로의 변경을 못 본다 (공용 relay 멀티테넌시)", async () => {
  // 같은 파일 구조지만 team 이 다른 두 그룹
  const aliceA = client("aliceA", "api", [payIdx], "team-A");
  const bobA = client("bobA", "web", [clientIdx], "team-A"); // 같은 팀
  const eveB = client("eveB", "web", [clientIdx], "team-B"); // 다른 팀, 같은 파일
  await Promise.all([aliceA.ready, bobA.ready, eveB.ready]);
  await sleep(150);

  aliceA.save("src/pay.ts", SIG_DIFF, payIdx);
  await sleep(600);

  // 같은 팀 bobA 는 받고, 다른 팀 eveB 는 절대 안 받는다
  assert.ok(bobA.inbox.some((m) => m.type === "impact"), "같은 팀 bobA 가 impact 못 받음");
  assert.ok(!eveB.inbox.some((m) => m.type === "impact"), "다른 팀 eveB 가 impact 를 받음(격리 실패!)");
  aliceA.close();
  bobA.close();
  eveB.close();
  await sleep(100);
});

test("presence: 접속/해제가 전원에게 브로드캐스트된다", async () => {
  const ann = client("ann", "api", [payIdx]);
  await ann.ready;
  await sleep(150);
  const bob = client("bob", "web", [clientIdx]);
  await bob.ready;
  await sleep(300);

  // bob 접속 후 ann 은 presence 에 두 명을 본다
  const lastPresence = [...ann.inbox].reverse().find((m) => m.type === "presence");
  assert.ok(lastPresence, "ann 이 presence 를 못 받음");
  const ids = lastPresence.peers.map((p) => p.userId).sort();
  assert.deepEqual(ids, ["ann", "bob"]);

  bob.close();
  await sleep(300);
  // bob 해제 후 ann 은 자신만 남은 presence 를 받는다
  const afterLeave = [...ann.inbox].reverse().find((m) => m.type === "presence");
  assert.deepEqual(afterLeave.peers.map((p) => p.userId), ["ann"]);
  ann.close();
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

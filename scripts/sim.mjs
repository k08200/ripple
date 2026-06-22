// Ripple E2E 시뮬레이터 — VS Code 두 창 없이 "저장 → 영향 알림" 전체 흐름을 증명한다.
// 두 명의 가짜 클라이언트를 띄운 백엔드(ws://localhost:7077)에 붙이고,
// Alice 가 시그니처를 바꿔 저장하면 → Bob 이 "너에게 영향" 을 받는지 본다.
//
// 실행: node scripts/sim.mjs   (먼저 backend 가 떠 있어야 함)

import { WebSocket } from "ws";

const URL = process.env.RIPPLE_URL ?? "ws://localhost:7077";

/** 한 명의 가짜 개발자. repo + 들고 있는 파일(+심볼 인덱스) + 받은 impact 로그. */
function makeClient(userId, repo, index) {
  const ws = new WebSocket(URL);
  const inbox = [];
  const files = index.map((i) => i.path);
  ws.on("open", () => ws.send(JSON.stringify({ type: "register", userId, repo, files, index })));
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "impact") inbox.push(msg);
  });
  return {
    userId,
    repo,
    files,
    inbox,
    ready: () => new Promise((res) => ws.on("open", res)),
    save: (file, diff) => ws.send(JSON.stringify({ type: "change", userId, repo, file, diff })),
    close: () => ws.close(),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bob 입장에서 "이 impact 가 내 파일을 가리키나?" — 익스텐션의 matchMine 과 같은 규칙. */
function hitsMe(impact, myFiles) {
  return impact.affected.some((a) => {
    const h = a.pathHint.toLowerCase().trim();
    if (h.length < 4) return false;
    return myFiles.some((f) => {
      const fl = `${f}`.toLowerCase();
      return fl === h || fl.endsWith(h) || h.endsWith(fl) || fl.includes(h) || h.includes(fl);
    });
  });
}

async function main() {
  console.log(`\n🌊 Ripple E2E 시뮬레이터 — ${URL}\n`);

  const alice = makeClient("alice", "payment-api", [
    { path: "src/payment.ts", exports: ["charge", "refund"], imports: [], refs: [] },
    { path: "src/db.ts", exports: ["query"], imports: ["./client"], refs: ["query"] }, // payment 안 씀 → 오탐 안 나야 함
  ]);
  const bob = makeClient("bob", "web", [
    { path: "src/payment-client.ts", exports: ["pay"], imports: ["payment-api/payment"], refs: ["charge"] },
    { path: "src/cart.ts", exports: ["addToCart"], imports: ["./payment-client"], refs: ["pay"] },
  ]);
  const carol = makeClient("carol", "ml", [
    { path: "train.py", exports: [], imports: ["pandas"], refs: [] },
    { path: "model.py", exports: ["Model"], imports: ["torch"], refs: [] },
  ]); // 무관한 사람

  await Promise.all([alice.ready(), bob.ready(), carol.ready()]);
  await sleep(200);
  console.log("3명 접속: alice(payment-api) · bob(web) · carol(ml)\n");

  // Alice 가 payment.ts 의 export 시그니처를 바꿔서 저장 (계약 변경 = high)
  const diff = [
    "@@",
    "-export function charge(amount: number): Promise<void>",
    "+export function charge(amount: number, currency: string): Promise<Receipt>",
  ].join("\n");

  console.log("▶ alice 가 src/payment.ts 저장 (charge() 시그니처 변경)\n");
  alice.save("src/payment.ts", diff);

  await sleep(1500); // 백엔드 분석 + 브로드캐스트 대기

  for (const c of [alice, bob, carol]) {
    const last = c.inbox[c.inbox.length - 1];
    if (!last) {
      console.log(`  ${c.userId.padEnd(6)} → (impact 못 받음)`);
      continue;
    }
    const mine = last.author === c.userId;
    const hit = !mine && hitsMe(last, c.files);
    const tag = mine ? "내 변경" : hit ? "🌊 너에게 영향!" : "관계없음";
    console.log(
      `  ${c.userId.padEnd(6)} → [${last.severity}] ${last.summary}\n` +
        `           affected=${JSON.stringify(last.affected.map((a) => a.pathHint))}  ⇒ ${tag}`,
    );
  }

  console.log("\n검증:");
  const last = bob.inbox[bob.inbox.length - 1];
  const bobHit = bob.inbox.some((m) => m.author !== "bob" && hitsMe(m, bob.files));
  const carolHit = carol.inbox.some((m) => m.author !== "carol" && hitsMe(m, carol.files));
  const dbFalsePos = (last?.affected ?? []).some((a) => a.pathHint.includes("db.ts"));
  console.log(`  bob 이 영향 알림 받음:        ${bobHit ? "✅ YES (기대대로)" : "❌ NO"}`);
  console.log(`  carol 은 영향 없음:           ${!carolHit ? "✅ YES (기대대로)" : "⚠️  오탐 발생"}`);
  console.log(`  db.ts 오탐 사라짐(graph):     ${!dbFalsePos ? "✅ YES (graph 가 import 엣지로 거름)" : "⚠️  여전히 오탐"}`);

  // 오프라인 catch-up: 변경이 끝난 *뒤에* 접속하는 dave — 놓친 영향을 백필받아야 한다.
  console.log("\n▶ dave 가 (변경 끝난 뒤) 뒤늦게 접속 — web repo, payment-client.ts 보유");
  const dave = makeClient("dave", "web", [
    { path: "src/payment-client.ts", exports: ["pay"], imports: ["payment-api/payment"], refs: ["charge"] },
  ]);
  await dave.ready();
  await sleep(800); // 백필 수신 대기

  const daveBackfill = dave.inbox.filter((m) => m.replay);
  const daveHit = daveBackfill.some((m) => hitsMe(m, dave.files));
  console.log(`  dave 백필 수신: ${dave.inbox.length}건 (replay=${daveBackfill.length})`);
  console.log(`  dave 가 놓친 영향 받음:        ${daveHit ? "✅ YES (접속 전 변경이 피드에 채워짐)" : "❌ NO"}`);

  alice.close();
  bob.close();
  carol.close();
  dave.close();
  await sleep(100);
  process.exit(0);
}

main().catch((e) => {
  console.error("시뮬레이터 오류 (backend 안 떠 있나?):", e.message);
  process.exit(1);
});

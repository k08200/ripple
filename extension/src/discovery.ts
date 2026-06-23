import * as dgram from "node:dgram";

// LAN 두뇌 자동 발견 (익스텐션 쪽). 브로드캐스트 질의 → 두뇌 응답의 IP/포트로 ws URL 구성.
// 같은 와이파이/서브넷 전제. 응답 없으면 undefined (→ 로컬 자동기동으로 폴백).

const DISCOVERY_PORT = 7078;
const QUERY = "RIPPLE_DISCOVER?";

/** 두뇌 응답 메시지에서 ws 포트 추출. ripple 응답이 아니면 undefined. */
export function parseReply(msg: string): number | undefined {
  try {
    const o = JSON.parse(msg) as { ripple?: unknown; port?: unknown };
    return o && o.ripple && typeof o.port === "number" ? o.port : undefined;
  } catch {
    return undefined;
  }
}

/** LAN 에 브로드캐스트 → 먼저 응답한 두뇌의 ws URL. timeout 내 없으면 undefined. */
export function discoverBrain(timeoutMs = 1200): Promise<string | undefined> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let done = false;
    const finish = (v: string | undefined): void => {
      if (done) return;
      done = true;
      try {
        sock.close();
      } catch {
        /* 무시 */
      }
      resolve(v);
    };
    sock.on("error", () => finish(undefined));
    sock.on("message", (buf, rinfo) => {
      const port = parseReply(buf.toString());
      if (port) finish(`ws://${rinfo.address}:${port}`);
    });
    sock.bind(() => {
      try {
        sock.setBroadcast(true);
        sock.send(QUERY, DISCOVERY_PORT, "255.255.255.255");
      } catch {
        finish(undefined);
      }
    });
    setTimeout(() => finish(undefined), timeoutMs);
  });
}

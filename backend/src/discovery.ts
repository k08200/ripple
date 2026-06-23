import * as dgram from "node:dgram";

// LAN 두뇌 자동 발견 (UDP 브로드캐스트, 의존성 0). 같은 와이파이/서브넷에서만 동작.
// 익스텐션이 "RIPPLE_DISCOVER?" 를 브로드캐스트하면 두뇌가 자기 ws 포트로 응답한다.
// → 고정 IP 없이도 누가 host 든 찾아 붙는다 (host 가 바뀌어도 OK).

export const DISCOVERY_PORT = 7078;
export const QUERY = "RIPPLE_DISCOVER?";

export function isQuery(msg: string): boolean {
  return msg === QUERY;
}

export function makeReply(wsPort: number): string {
  return JSON.stringify({ ripple: 1, port: wsPort });
}

/** 두뇌 쪽: 발견 질의에 자기 ws 포트로 응답하는 UDP 리스너. */
export function startResponder(wsPort: number, log: (m: string) => void = () => {}): dgram.Socket {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sock.on("error", (e) => log(`discovery 오류: ${e.message}`));
  sock.on("message", (buf, rinfo) => {
    if (isQuery(buf.toString())) sock.send(makeReply(wsPort), rinfo.port, rinfo.address);
  });
  sock.bind(DISCOVERY_PORT, () => {
    try {
      sock.setBroadcast(true);
    } catch {
      /* 일부 환경에서 불가 — 무시 */
    }
    log(`LAN 발견 응답 대기 (udp :${DISCOVERY_PORT})`);
  });
  return sock;
}

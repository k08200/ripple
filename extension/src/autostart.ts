// 로컬 두뇌 자동 기동 판단 — "설치만 하면 됨"을 위해 로컬이면 두뇌를 알아서 띄운다.
// 순수 함수만 (spawn 은 extension.ts 가 함). 팀 모드(원격 backendUrl)면 자동기동 안 함.

export function isLocalUrl(url: string): boolean {
  return /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url.trim());
}

/** 기본 로컬 두뇌 주소인가 — localhost/127.0.0.1 의 기본 포트(7077)면 "수동 지정 아님"으로 본다.
 *  설정에 ws://localhost:7077 이 남아 있어도 자동기동·127.0.0.1 수렴 경로를 타게 하기 위함. */
export function isDefaultLocal(url: string): boolean {
  return /^wss?:\/\/(localhost|127\.0\.0\.1):7077\/?$/.test(url.trim());
}

export function parsePort(url: string, fallback = 7077): number {
  const m = url.match(/:(\d{2,5})(\/|$)/);
  return m ? Number(m[1]) : fallback;
}

/** 로컬 주소 + 설정 on 일 때만 자동기동. 원격(공용 두뇌)이면 false. */
export function shouldAutoStart(url: string, enabled: boolean): boolean {
  return enabled && isLocalUrl(url);
}

/** host 선출용 무작위 대기 상한(ms). */
export const ELECTION_MAX_MS = 2500;

/** 두뇌를 못 찾았을 때 self-start 전에 기다릴 무작위 시간(ms).
 *  host 가 동시에 사라지면 모두가 같은 순간 재연결→발견 실패→각자 두뇌 기동 = split-brain.
 *  각 클라가 [0, MAX) 에서 서로 다른 시간을 뽑아 기다린 뒤 한 번 더 발견을 시도하면,
 *  가장 짧게 뽑은 한 명만 host 가 되고 나머지는 그 사이 떠오른 host 를 찾아 붙는다(단일 host 로 수렴).
 *  rand 주입 가능 → 결정적 테스트. */
export function electionDelayMs(rand: () => number = Math.random): number {
  return Math.floor(rand() * ELECTION_MAX_MS);
}

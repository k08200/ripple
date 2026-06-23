// 로컬 두뇌 자동 기동 판단 — "설치만 하면 됨"을 위해 로컬이면 두뇌를 알아서 띄운다.
// 순수 함수만 (spawn 은 extension.ts 가 함). 팀 모드(원격 backendUrl)면 자동기동 안 함.

export function isLocalUrl(url: string): boolean {
  return /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url.trim());
}

export function parsePort(url: string, fallback = 7077): number {
  const m = url.match(/:(\d{2,5})(\/|$)/);
  return m ? Number(m[1]) : fallback;
}

/** 로컬 주소 + 설정 on 일 때만 자동기동. 원격(공용 두뇌)이면 false. */
export function shouldAutoStart(url: string, enabled: boolean): boolean {
  return enabled && isLocalUrl(url);
}

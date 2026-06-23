// Ripple 와이어 프로토콜 — 익스텐션 <-> 백엔드 사이 WebSocket 메시지.
// 익스텐션 쪽에도 동일한 타입이 mirror 되어 있다 (extension/src/protocol.ts).

export type Severity = "info" | "low" | "high";

/** 파일의 가벼운 심볼 인덱스 — 익스텐션이 만들어 register 에 실어 보낸다.
 *  이게 있으면 백엔드가 "파일명 추측" 이 아니라 실제 import/참조 엣지로 영향을 판단한다. */
export interface FileIndex {
  /** repo 기준 상대 경로. */
  path: string;
  /** 이 파일이 export 하는 심볼 이름들. */
  exports: string[];
  /** 이 파일이 import 하는 모듈 specifier (예: "./payment", "../shared/types/order"). */
  imports: string[];
  /** 이 파일이 참조하는 심볼/문자열(라우트 경로 등). 영향 역방향 매칭에 사용. */
  refs: string[];
}

/** 클라이언트가 접속하며 자신과 워크스페이스 파일 목록을 알린다. */
export interface RegisterMessage {
  type: "register";
  userId: string;
  repo: string;
  /** repo 기준 상대 경로. 서버가 "누가 무슨 파일을 들고 있는지" 라우팅에 쓴다. */
  files: string[];
  /** 파일별 심볼 인덱스(옵션). 없으면 경로만으로 폴백. */
  index?: FileIndex[];
}

/** 파일 저장이 일어났을 때 보내는 변경 이벤트. */
export interface ChangeMessage {
  type: "change";
  userId: string;
  repo: string;
  /** repo 기준 상대 경로. */
  file: string;
  /** 라인 단위 unified-ish diff 텍스트. */
  diff: string;
  /** 저장 직후 이 파일의 갱신된 심볼 인덱스(옵션) — 세션 중 인덱스를 최신으로 유지. */
  index?: FileIndex;
}

/** 파일 생성/삭제 시 인덱스 한 항목을 즉시 갱신/제거 (세션 중 신규 파일도 분석 후보로). */
export interface IndexMessage {
  type: "index";
  repo: string;
  op: "upsert" | "remove";
  /** repo 기준 상대 경로. */
  path: string;
  index?: FileIndex;
}

export type ClientMessage = RegisterMessage | ChangeMessage | IndexMessage;

/** AI가 짚은 "영향 갈 만한 곳" 한 건. */
export interface AffectedHint {
  /** 영향받을 파일 경로나 심볼 (예: "web/src/api/auth.ts" 또는 "loginUser()"). */
  pathHint: string;
  /** 왜 영향받는지 한 줄. */
  reason: string;
}

/** 서버가 분석을 끝내고 모두에게 뿌리는 영향 분석 결과. */
export interface ImpactMessage {
  type: "impact";
  id: string;
  author: string;
  repo: string;
  file: string;
  /** 사람이 읽는 한 줄 요약. */
  summary: string;
  severity: Severity;
  affected: AffectedHint[];
  /** epoch millis. */
  ts: number;
  /** 접속 시 백필된 과거 변경이면 true — 클라는 알림 팝업 없이 피드에만 채운다. */
  replay?: boolean;
}

/** 접속자 목록 — 접속/해제 시 전원에게 브로드캐스트해 팀 presence 를 보여준다. */
export interface PresenceMessage {
  type: "presence";
  peers: { userId: string; repo: string }[];
}

export type ServerMessage = ImpactMessage | PresenceMessage;

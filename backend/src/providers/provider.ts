import type { AffectedHint, Severity } from "../protocol.js";

/** 팀 전체 파일의 심볼 인덱스 한 건. path 는 `${repo}/${rel}` 로 정규화돼 있다. */
export interface KnownFile {
  path: string;
  exports: string[];
  imports: string[];
  refs: string[];
}

/** 영향 분석에 들어가는 입력. */
export interface AnalyzeInput {
  repo: string;
  file: string;
  diff: string;
  /** 팀 전체에서 서버가 알고 있는 파일 경로들 (영향 대상 후보). */
  knownFiles: string[];
  /** 파일별 심볼 인덱스(있으면 그래프 기반 분석 가능). 없으면 경로만으로 폴백. */
  knownIndex?: KnownFile[];
}

/** 바뀐 심볼의 before→after 선언 (어떻게 바뀌었나). 제거면 after 없음, 추가면 before 없음. */
export interface ChangeDetail {
  symbol: string;
  before?: string;
  after?: string;
  /** 사람 말 요약 (예: "currency 인자 추가 · 반환 void → Receipt"). */
  note?: string;
}

export interface AnalyzeResult {
  summary: string;
  severity: Severity;
  affected: AffectedHint[];
  /** 이 변경에서 실제로 바뀐 심볼/라우트(예: ["charge","/v2/login"]).
   *  수신자 쪽에서 자기 파일의 '사용 위치'를 찾는 데 쓴다. */
  changedSymbols: string[];
  /** 바뀐 export 의 before→after 선언 (시그니처 변경의 '어떻게'). */
  changeDetails: ChangeDetail[];
}

/** AI 영향 분석 백엔드 추상화. 클코/코덱스/목 등으로 교체 가능. */
export interface Provider {
  readonly name: string;
  analyze(input: AnalyzeInput): Promise<AnalyzeResult>;
}

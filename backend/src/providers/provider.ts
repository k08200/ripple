import type { AffectedHint, Severity } from "../protocol.js";

/** 영향 분석에 들어가는 입력. */
export interface AnalyzeInput {
  repo: string;
  file: string;
  diff: string;
  /** 팀 전체에서 서버가 알고 있는 파일 경로들 (영향 대상 후보). */
  knownFiles: string[];
}

export interface AnalyzeResult {
  summary: string;
  severity: Severity;
  affected: AffectedHint[];
}

/** AI 영향 분석 백엔드 추상화. 클코/코덱스/목 등으로 교체 가능. */
export interface Provider {
  readonly name: string;
  analyze(input: AnalyzeInput): Promise<AnalyzeResult>;
}

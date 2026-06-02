// Ripple 와이어 프로토콜 — backend/src/protocol.ts 와 동일하게 유지할 것.

export type Severity = "info" | "low" | "high";

export interface RegisterMessage {
  type: "register";
  userId: string;
  repo: string;
  files: string[];
}

export interface ChangeMessage {
  type: "change";
  userId: string;
  repo: string;
  file: string;
  diff: string;
}

export type ClientMessage = RegisterMessage | ChangeMessage;

export interface AffectedHint {
  pathHint: string;
  reason: string;
}

export interface ImpactMessage {
  type: "impact";
  id: string;
  author: string;
  repo: string;
  file: string;
  summary: string;
  severity: Severity;
  affected: AffectedHint[];
  ts: number;
}

export type ServerMessage = ImpactMessage;

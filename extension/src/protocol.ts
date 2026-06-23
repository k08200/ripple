// Ripple 와이어 프로토콜 — backend/src/protocol.ts 와 동일하게 유지할 것.

export type Severity = "info" | "low" | "high";

export interface FileIndex {
  path: string;
  exports: string[];
  imports: string[];
  refs: string[];
}

export interface RegisterMessage {
  type: "register";
  userId: string;
  repo: string;
  files: string[];
  index?: FileIndex[];
}

export interface ChangeMessage {
  type: "change";
  userId: string;
  repo: string;
  file: string;
  diff: string;
  index?: FileIndex;
}

export interface IndexMessage {
  type: "index";
  repo: string;
  op: "upsert" | "remove";
  path: string;
  index?: FileIndex;
}

export type ClientMessage = RegisterMessage | ChangeMessage | IndexMessage;

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
  changedSymbols: string[];
  ts: number;
  replay?: boolean;
}

export interface PresenceMessage {
  type: "presence";
  peers: { userId: string; repo: string }[];
}

export type ServerMessage = ImpactMessage | PresenceMessage;

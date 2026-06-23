import { readFileSync, writeFileSync } from "node:fs";
import type { ImpactMessage } from "./protocol.js";

// 영향 히스토리 디스크 영속 — 두뇌를 재시작해도 "놓친 변경" 백필이 유지된다.
// 각 항목은 team(room) 으로 태그돼 같은 팀에게만 백필된다. 깨진/없는 파일은 빈 히스토리로 폴백.

export interface HistoryEntry {
  team: string;
  impact: ImpactMessage;
}

export function loadHistory(path: string, max: number): HistoryEntry[] {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (e) =>
          e &&
          typeof e.team === "string" &&
          e.impact &&
          e.impact.type === "impact" &&
          typeof e.impact.id === "string" &&
          typeof e.impact.author === "string" &&
          Array.isArray(e.impact.affected),
      )
      .slice(-max);
  } catch {
    return [];
  }
}

export function saveHistory(path: string, history: HistoryEntry[]): void {
  try {
    writeFileSync(path, JSON.stringify(history));
  } catch (err) {
    console.error("[history] 저장 실패:", err instanceof Error ? err.message : String(err));
  }
}

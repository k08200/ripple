import { readFileSync, writeFileSync } from "node:fs";
import type { ImpactMessage } from "./protocol.js";

// 영향 히스토리 디스크 영속 — 두뇌를 재시작해도 "놓친 변경" 백필이 유지된다.
// 깨진/없는 파일은 빈 히스토리로 폴백(조용히 죽지 않음).

export function loadHistory(path: string, max: number): ImpactMessage[] {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(data)) return [];
    return data.filter((m) => m && m.type === "impact").slice(-max);
  } catch {
    return [];
  }
}

export function saveHistory(path: string, history: ImpactMessage[]): void {
  try {
    writeFileSync(path, JSON.stringify(history));
  } catch (err) {
    console.error("[history] 저장 실패:", err instanceof Error ? err.message : String(err));
  }
}

import type { ImpactMessage } from "./protocol.js";

// 영향 매칭 — 백엔드 백필과 클라 알림이 같은 규칙을 쓴다.
// "affected pathHint 가 내 파일 중 하나를 가리키나?" 를 느슨하게(부분일치) 판정.

const MIN_HINT = 4;

export function pathMatches(hint: string, file: string): boolean {
  const h = hint.toLowerCase().trim();
  if (h.length < MIN_HINT) return false;
  const fl = file.toLowerCase();
  return fl === h || fl.endsWith(h) || h.endsWith(fl) || fl.includes(h) || h.includes(fl);
}

/** 이 impact 의 affected 가 주어진 파일 집합(`${repo}/${rel}`) 중 하나라도 가리키나? */
export function impactTouches(impact: ImpactMessage, files: Iterable<string>): boolean {
  const list = [...files];
  return impact.affected.some((a) => list.some((f) => pathMatches(a.pathHint, f)));
}

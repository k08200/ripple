import type { KnownFile } from "./providers/provider.js";

// 세션 중 파일이 바뀌면 인덱스도 바뀐다(export/import 추가·삭제).
// 저장 때마다 그 파일 인덱스를 갈아끼워 백엔드 분석 후보를 최신으로 유지.
// 불변: 항상 새 배열을 돌려준다.

export function upsertIndex(list: KnownFile[], kf: KnownFile): KnownFile[] {
  const next = list.filter((k) => k.path !== kf.path);
  next.push(kf);
  return next;
}

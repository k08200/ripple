// 팀 room id 도출 — 같은 git 원격(=같은 프로젝트)이면 같은 room 으로 자동 격리.
// 설정(ripple.team) > git remote > 워크스페이스 이름 순. 순수 함수만 (git 실행은 extension.ts).

/** git 원격 URL 을 안정적인 room 키로 정규화. 프로토콜/형식 달라도 같은 repo면 같은 값. */
/** git 원격 URL 에서 GitHub owner/repo 추출 (github 만). 순수 — 테스트 가능. */
export function parseOwnerRepo(remote: string): { owner: string; repo: string } | undefined {
  const m = remote.match(/github\.com[:/]([^/]+)\/([^/.\s]+)/i);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/, "") } : undefined;
}

export function normalizeTeam(remoteUrl: string): string {
  return remoteUrl
    .trim()
    .toLowerCase()
    .replace(/^ssh:\/\//, "")
    .replace(/^https?:\/\//, "")
    .replace(/^git@/, "")
    .replace(/:/g, "/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

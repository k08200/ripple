import * as vscode from "vscode";

// 열린 PR 을 GitHub 에서 가져와 "변경"으로 만들어 두뇌에 보낸다 → 같은 엔진이 분석 →
// 피드에 PR 영향이 뜬다. VS Code 의 GitHub 로그인을 쓰므로 추가 토큰 설정 0.

export interface PrChange {
  pr: { number: number; url: string; title: string; head: string };
  author: string;
  file: string;
  diff: string;
}

/** git 원격 URL 에서 owner/repo 추출 (github 만). */
export function parseOwnerRepo(remote: string): { owner: string; repo: string } | undefined {
  const m = remote.match(/github\.com[:/]([^/]+)\/([^/.\s]+)/i);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/, "") } : undefined;
}

async function ghToken(interactive: boolean): Promise<string | undefined> {
  try {
    const s = await vscode.authentication.getSession("github", ["repo"], { createIfNone: interactive });
    return s?.accessToken;
  } catch {
    return undefined;
  }
}

async function ghJson(path: string, token: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "user-agent": "ripple",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

/** 열린 PR 들의 변경 파일(patch)을 PrChange 로. interactive=true 면 로그인 프롬프트 허용. */
export async function fetchOpenPrChanges(
  remoteUrl: string,
  isCode: (f: string) => boolean,
  interactive = false,
): Promise<PrChange[]> {
  const or = parseOwnerRepo(remoteUrl);
  if (!or) return [];
  const token = await ghToken(interactive);
  if (!token) return []; // 로그인 안 됨 → 조용히 스킵 (명령으로 켤 수 있음)

  const prs = (await ghJson(`/repos/${or.owner}/${or.repo}/pulls?state=open&per_page=20`, token)) as Array<{
    number: number; html_url: string; title: string; head: { sha: string }; user: { login: string };
  }>;
  const out: PrChange[] = [];
  for (const pr of prs) {
    const files = (await ghJson(`/repos/${or.owner}/${or.repo}/pulls/${pr.number}/files?per_page=100`, token)) as Array<{
      filename: string; patch?: string;
    }>;
    for (const f of files) {
      if (!f.patch || !isCode(f.filename)) continue;
      out.push({
        pr: { number: pr.number, url: pr.html_url, title: pr.title, head: pr.head.sha },
        author: pr.user?.login ?? `PR #${pr.number}`,
        file: f.filename,
        diff: f.patch,
      });
    }
  }
  return out;
}

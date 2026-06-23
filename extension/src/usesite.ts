// 영향받은 파일 본문(lines)에서 바뀐 심볼이 실제로 쓰인 첫 위치를 찾는다.
// 순수 함수 — vscode I/O 와 분리해 테스트 가능. (식별자는 단어경계, 라우트 등은 부분일치)

export interface SiteHit {
  line: number;
  text: string;
}

const MIN_SYMBOL = 3;
const MAX_TEXT = 120;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function locateUseSites(
  lines: string[],
  symbols: string[],
  maxPerSymbol = 3,
  maxTotal = 8,
): SiteHit[] {
  const sites: SiteHit[] = [];
  for (const sym of symbols) {
    if (sym.length < MIN_SYMBOL || sites.length >= maxTotal) continue;
    const isIdent = /^[A-Za-z_$][\w$]*$/.test(sym);
    const re = isIdent ? new RegExp(`\\b${escapeRe(sym)}\\b`) : null;
    let perSym = 0;
    for (let i = 0; i < lines.length && perSym < maxPerSymbol && sites.length < maxTotal; i++) {
      if (re ? re.test(lines[i]) : lines[i].includes(sym)) {
        sites.push({ line: i + 1, text: lines[i].trim().slice(0, MAX_TEXT) });
        perSym += 1;
      }
    }
  }
  return sites;
}

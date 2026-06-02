// 의존성 없는 라인 단위 diff. 저장 전/후 텍스트를 받아 unified-ish 텍스트를 만든다.
// 키 입력 단위가 아니라 "파일 저장 단위" — 반쯤 쓴 코드 노이즈를 피하기 위함.

const MAX_CELLS = 4_000_000; // LCS 매트릭스 폭주 가드 (대략 2000x2000 라인)
const MAX_OUTPUT_LINES = 400;

interface Op {
  tag: " " | "+" | "-";
  line: string;
}

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split("\n");
}

function naiveDiff(a: string[], b: string[]): Op[] {
  // 너무 큰 파일: 통째 교체로 표현.
  return [...a.map((line): Op => ({ tag: "-", line })), ...b.map((line): Op => ({ tag: "+", line }))];
}

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) return naiveDiff(a, b);

  // dp[i][j] = a[i..], b[j..] 의 LCS 길이
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ tag: " ", line: a[i++] }), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ tag: "-", line: a[i++] });
    else ops.push({ tag: "+", line: b[j++] });
  }
  while (i < n) ops.push({ tag: "-", line: a[i++] });
  while (j < m) ops.push({ tag: "+", line: b[j++] });
  return ops;
}

/** 변경된 라인 주변 `context` 줄만 남기고 나머지 공백 라인은 접는다. */
function collapse(ops: Op[], context: number): string {
  const keep = new Array<boolean>(ops.length).fill(false);
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].tag === " ") continue;
    const from = Math.max(0, k - context);
    const to = Math.min(ops.length - 1, k + context);
    for (let x = from; x <= to; x++) keep[x] = true;
  }

  const out: string[] = [];
  let skipping = false;
  for (let k = 0; k < ops.length && out.length < MAX_OUTPUT_LINES; k++) {
    if (keep[k]) {
      out.push(ops[k].tag + ops[k].line);
      skipping = false;
    } else if (!skipping) {
      out.push("@@");
      skipping = true;
    }
  }
  return out.join("\n");
}

export function lineDiff(oldText: string, newText: string, context = 2): string {
  const ops = lcsOps(splitLines(oldText), splitLines(newText));
  if (!ops.some((o) => o.tag !== " ")) return "";
  return collapse(ops, context);
}

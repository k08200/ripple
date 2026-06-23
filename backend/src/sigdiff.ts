// before→after 선언을 결정론적으로 비교해 "무엇이 어떻게 바뀌었나"를 사람 말로.
// 인자 추가/제거 + 반환 타입 변경. LLM 불필요 — 순수 파싱.

interface Sig {
  params: string[];
  ret: string;
}

function parseSig(decl: string): Sig {
  const pm = decl.match(/\(([^)]*)\)/);
  const params = pm
    ? pm[1]
        .split(",")
        .map((p) => p.trim().split(":")[0].trim().replace(/\?$/, ""))
        .filter(Boolean)
    : [];
  const rm = decl.match(/\)\s*:\s*([^{=]+?)\s*(\{|=>|$)/);
  const ret = rm ? rm[1].trim() : "";
  return { params, ret };
}

/** 시그니처 변경을 한 줄로 묘사. 묘사할 게 없으면 undefined. */
export function describeSignatureChange(before: string, after: string): string | undefined {
  const b = parseSig(before);
  const a = parseSig(after);
  const added = a.params.filter((p) => !b.params.includes(p));
  const removed = b.params.filter((p) => !a.params.includes(p));

  const parts: string[] = [];
  if (added.length) parts.push(`${added.join(", ")} 인자 추가`);
  if (removed.length) parts.push(`${removed.join(", ")} 인자 제거`);
  if (b.ret && a.ret && b.ret !== a.ret) parts.push(`반환 ${b.ret} → ${a.ret}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

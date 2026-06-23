// unified-ish diff 에서 추가/삭제된 라인만 뽑는다. graph·mock provider 공용.

export interface Changed {
  added: string[];
  removed: string[];
}

export function changedLines(diff: string, maxLines = 100_000): Changed {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of diff.split("\n").slice(0, maxLines)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
    else if (line.startsWith("-") && !line.startsWith("---")) removed.push(line.slice(1));
  }
  return { added, removed };
}

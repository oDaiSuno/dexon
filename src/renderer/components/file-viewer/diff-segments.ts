import type { DiffLine } from "@/lib/text-diff";

const CONTEXT = 3;
const DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function\*?|class|interface|enum|type|def|fn|func|struct|impl|const|let|var)\s+([A-Za-z_$][\w$]*)/;

export type DiffBlock =
  { kind: "lines"; start: number; lines: DiffLine[] } | { kind: "fold"; start: number; count: number };

export type DiffSegment = { hidden: true; count: number } | { hidden: false; lines: DiffLine[] };

export interface DiffLayout {
  header: string | null;
  blocks: DiffBlock[];
}

function visibleMask(diff: DiffLine[], expandedFolds: ReadonlySet<number>): boolean[] {
  const visible = diff.map(() => false);
  diff.forEach((line, index) => {
    if (line.type === "unchanged") return;
    const last = Math.min(diff.length - 1, index + CONTEXT);
    for (let j = Math.max(0, index - CONTEXT); j <= last; j++) visible[j] = true;
  });
  let index = 0;
  while (index < diff.length) {
    if (visible[index]) {
      index++;
      continue;
    }
    const start = index;
    while (index < diff.length && !visible[index]) index++;
    if (start > 0 && index < diff.length && expandedFolds.has(start)) visible.fill(true, start, index);
  }
  return visible;
}

function range(start: number, count: number): string {
  return count === 1 ? String(start) : `${start},${count}`;
}

function enclosingDeclaration(diff: DiffLine[], before: number): string {
  for (let index = before - 1; index >= 0; index--) {
    const line = diff[index];
    if (line.type === "added") continue;
    const match = DECLARATION.exec(line.text);
    if (match) return `${match[1]} ${match[2]}`;
  }
  return "";
}

function hunkHeader(diff: DiffLine[], start: number, lines: DiffLine[]): string {
  const oldNumbers = lines.flatMap((line) => (line.type === "added" ? [] : [line.oldLineNo]));
  const newNumbers = lines.flatMap((line) => (line.type === "removed" ? [] : [line.newLineNo]));
  const header = `@@ \u2212${range(oldNumbers[0] ?? 0, oldNumbers.length)} +${range(newNumbers[0] ?? 0, newNumbers.length)} @@`;
  const context = enclosingDeclaration(diff, start);
  return context ? `${header}  ${context}` : header;
}

function runs(visible: boolean[]): { shown: boolean; start: number; end: number }[] {
  const result: { shown: boolean; start: number; end: number }[] = [];
  let index = 0;
  while (index < visible.length) {
    const start = index;
    const shown = visible[index];
    while (index < visible.length && visible[index] === shown) index++;
    result.push({ shown, start, end: index });
  }
  return result;
}

export function layoutDiff(diff: DiffLine[], expandedFolds: ReadonlySet<number>): DiffLayout {
  const blocks = runs(visibleMask(diff, expandedFolds)).flatMap<DiffBlock>(({ shown, start, end }) => {
    if (shown) return [{ kind: "lines", start, lines: diff.slice(start, end) }];
    return start > 0 && end < diff.length ? [{ kind: "fold", start, count: end - start }] : [];
  });
  const first = blocks.find((block) => block.kind === "lines");
  return { header: first ? hunkHeader(diff, first.start, first.lines) : null, blocks };
}

export function collapseDiff(diff: DiffLine[]): DiffSegment[] {
  return runs(visibleMask(diff, new Set())).map(({ shown, start, end }) =>
    shown ? { hidden: false, lines: diff.slice(start, end) } : { hidden: true, count: end - start },
  );
}

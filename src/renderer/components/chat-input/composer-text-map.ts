import { chipText, isChipEl } from "./composer-dom";

export interface ComposerPoint {
  node: Node;
  offset: number;
}

type Run =
  | { kind: "text"; node: Text; from: number; to: number; start: number; value: string }
  | { kind: "atom"; node: Node; chip: boolean; start: number; value: string }
  | { kind: "gap"; before: ComposerPoint; after: ComposerPoint; start: number; value: string };

export interface ComposerTextMap {
  text: string;
  masked: string;
  runs: readonly Run[];
}

const BLOCK_TAGS = new Set(["DIV", "P", "LI", "UL", "OL", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6"]);
const MASK = "\uFFFC";

function pointBefore(node: Node): ComposerPoint {
  const parent = node.parentNode!;
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) as number };
}

function pointAfter(node: Node): ComposerPoint {
  const before = pointBefore(node);
  return { node: before.node, offset: before.offset + 1 };
}

function runStart(run: Run): ComposerPoint {
  if (run.kind === "text") return { node: run.node, offset: run.from };
  if (run.kind === "atom") return pointBefore(run.node);
  return run.before;
}

function runEnd(run: Run): ComposerPoint {
  if (run.kind === "text") return { node: run.node, offset: run.to };
  if (run.kind === "atom") return pointAfter(run.node);
  return run.after;
}

interface Line {
  runs: Run[];
  end: ComposerPoint;
}

function collectLines(root: HTMLElement): Line[] {
  const lines: Line[] = [];
  let runs: Run[] | null = null;
  const closeLine = (end: ComposerPoint) => {
    if (runs) lines.push({ runs, end });
    runs = null;
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data;
      if (!data) return;
      (runs ??= []).push({ kind: "text", node: node as Text, from: 0, to: data.length, start: 0, value: "" });
      return;
    }
    if (isChipEl(node)) {
      (runs ??= []).push({ kind: "atom", node, chip: true, start: 0, value: chipText(node) });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      (runs ??= []).push({ kind: "atom", node, chip: false, start: 0, value: "\n" });
      return;
    }
    const block = BLOCK_TAGS.has(node.tagName);
    if (block) closeLine(pointBefore(node));
    node.childNodes.forEach(visit);
    if (block) closeLine({ node, offset: node.childNodes.length });
  };
  root.childNodes.forEach(visit);
  closeLine({ node: root, offset: root.childNodes.length });
  return lines;
}

function dropTrailingBreak(line: Run[]): ComposerPoint | null {
  const last = line[line.length - 1];
  if (!last || last.kind === "gap") return null;
  if (last.kind === "atom") {
    if (last.chip) return null;
    line.pop();
    return pointBefore(last.node);
  }
  if (last.node.data[last.to - 1] === "\n") last.to -= 1;
  return null;
}

function withGlue(line: Run[]): Run[] {
  const values = line.map((run) => (run.kind === "text" ? run.node.data.slice(run.from, run.to) : run.value));
  const charBefore = (index: number) => {
    for (let i = index - 1; i >= 0; i--) if (values[i]) return values[i][values[i].length - 1];
    return "";
  };
  const charAfter = (index: number) => {
    for (let i = index + 1; i < values.length; i++) if (values[i]) return values[i][0];
    return "";
  };
  const out: Run[] = [];
  line.forEach((run, index) => {
    const before = charBefore(index);
    const after = charAfter(index);
    const chip = run.kind === "atom" && run.chip;
    if (chip && before && !/\s/.test(before) && out[out.length - 1]?.kind !== "gap") {
      const point = pointBefore(run.node);
      out.push({ kind: "gap", before: point, after: point, start: 0, value: " " });
    }
    out.push(run);
    if (chip && after && !/\s/.test(after)) {
      const point = pointAfter(run.node);
      out.push({ kind: "gap", before: point, after: point, start: 0, value: " " });
    }
  });
  return out;
}

export function readComposerText(root: HTMLElement): ComposerTextMap {
  const runs: Run[] = [];
  let text = "";
  let masked = "";
  const append = (run: Run, value: string, maskedValue: string) => {
    run.start = text.length;
    run.value = value;
    runs.push(run);
    text += value;
    masked += maskedValue;
  };
  let previousEnd: ComposerPoint = { node: root, offset: 0 };
  collectLines(root).forEach((line, index) => {
    const placeholder = dropTrailingBreak(line.runs);
    const lineStart = line.runs.length ? runStart(line.runs[0]) : (placeholder ?? previousEnd);
    if (index > 0) append({ kind: "gap", before: previousEnd, after: lineStart, start: 0, value: "" }, "\n", "\n");
    for (const run of withGlue(line.runs)) {
      if (run.kind === "text") {
        const value = run.node.data.slice(run.from, run.to).replace(/\u00a0/g, " ");
        append(run, value, value);
      } else {
        append(run, run.value, run.kind === "atom" && run.chip ? MASK.repeat(run.value.length) : run.value);
      }
    }
    previousEnd = line.runs.length ? line.end : lineStart;
  });
  return { text, masked, runs };
}

function runLength(run: Run): number {
  return run.kind === "text" ? run.to - run.from : run.value.length;
}

export function offsetAtPoint(map: ComposerTextMap, point: ComposerPoint): number {
  const probe = point.node.ownerDocument!.createRange();
  probe.setStart(point.node, point.offset);
  for (const run of map.runs) {
    if (run.kind === "text" && run.node === point.node) {
      return run.start + Math.max(0, Math.min(point.offset - run.from, run.to - run.from));
    }
    const start = runStart(run);
    if (probe.comparePoint(start.node, start.offset) >= 0) return run.start;
  }
  return map.text.length;
}

export function pointAtOffset(map: ComposerTextMap, root: HTMLElement, offset: number): ComposerPoint {
  for (const run of map.runs) {
    const length = runLength(run);
    if (run.kind === "text" && offset >= run.start && offset <= run.start + length) {
      return { node: run.node, offset: run.from + offset - run.start };
    }
    if (offset <= run.start) return runStart(run);
    if (offset < run.start + length) return runEnd(run);
  }
  const last = map.runs[map.runs.length - 1];
  return last ? runEnd(last) : { node: root, offset: 0 };
}

export function rangeAtOffsets(map: ComposerTextMap, root: HTMLElement, start: number, end: number): Range {
  const range = root.ownerDocument.createRange();
  const from = pointAtOffset(map, root, start);
  range.setStart(from.node, from.offset);
  if (end === start) {
    range.collapse(true);
    return range;
  }
  const to = pointAtOffset(map, root, end);
  range.setEnd(to.node, to.offset);
  return range;
}

export interface ComposerSelection {
  start: number;
  end: number;
}

export function selectionInComposer(root: HTMLElement, map: ComposerTextMap): ComposerSelection | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = offsetAtPoint(map, { node: range.startContainer, offset: range.startOffset });
  const end = range.collapsed ? start : offsetAtPoint(map, { node: range.endContainer, offset: range.endOffset });
  return { start, end };
}

export function selectOffsets(root: HTMLElement, map: ComposerTextMap, start: number, end: number): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(rangeAtOffsets(map, root, start, end));
}

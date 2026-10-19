import { buildAtInsertText, extractAtQuery, type AtQueryMatch } from "@/lib/file-fuzzy";
import { looksLikePath } from "@shared/attachment-tokens";
import { findLeadingSkillCommand, skillCommandText } from "@shared/skill-commands";
import { SKILL_ATTR, segmentComposerText, type ComposerSegment } from "./composer-dom";
import { readComposerText, selectOffsets, type ComposerSelection, type ComposerTextMap } from "./composer-text-map";

export interface ChipFactory {
  attachment(path: string): HTMLElement;
  skill(name: string): HTMLElement;
}

export interface ComposerEdit {
  start: number;
  end: number;
  content: readonly ComposerSegment[];
  caretFromEnd?: number;
}

const editingRoots = new WeakSet<HTMLElement>();

function buildNodes(doc: Document, content: readonly ComposerSegment[], chips: ChipFactory): Node[] {
  return content.flatMap((segment): Node[] => {
    if (segment.type === "text") return segment.text ? [doc.createTextNode(segment.text)] : [];
    return [segment.type === "skill" ? chips.skill(segment.name) : chips.attachment(segment.path)];
  });
}

function runNativeCommand(root: HTMLElement, command: () => boolean): boolean {
  const doc = root.ownerDocument;
  if (editingRoots.has(root) || typeof doc.execCommand !== "function") return false;
  editingRoots.add(root);
  try {
    return command();
  } finally {
    editingRoots.delete(root);
  }
}

export function applyComposerEdit(root: HTMLElement, edit: ComposerEdit, chips: ChipFactory): boolean {
  const doc = root.ownerDocument;
  const before = readComposerText(root);
  const holder = doc.createElement("div");
  holder.append(...buildNodes(doc, edit.content, chips));
  const markup = holder.innerHTML;
  if (!markup && edit.start === edit.end) return true;
  selectOffsets(root, before, edit.start, edit.end);
  const applied = runNativeCommand(root, () =>
    markup ? doc.execCommand("insertHTML", false, markup) : doc.execCommand("delete"),
  );
  if (!applied) return false;
  if (edit.caretFromEnd) {
    const after = readComposerText(root);
    const caret = after.text.length - (before.text.length - edit.end) - edit.caretFromEnd;
    selectOffsets(root, after, caret, caret);
  }
  return true;
}

export function insertNativeLineBreak(root: HTMLElement): boolean {
  return runNativeCommand(root, () => root.ownerDocument.execCommand("insertLineBreak"));
}

export function resetComposerContent(root: HTMLElement, text: string, chips: ChipFactory): void {
  const parent = root.parentNode;
  const next = root.nextSibling;
  parent?.removeChild(root);
  root.replaceChildren(...buildNodes(root.ownerDocument, segmentsForValue(text), chips));
  parent?.insertBefore(root, next);
}

function segmentsForValue(text: string): ComposerSegment[] {
  const segments = segmentComposerText(text);
  return text.endsWith("\n") ? [...segments, { type: "text", text: "\n" }] : segments;
}

function segmentsForInsert(text: string, atMessageStart: boolean): ComposerSegment[] {
  return segmentComposerText(text).map((segment) =>
    segment.type === "skill" && !atMessageStart ? { type: "text", text: skillCommandText(segment.name) } : segment,
  );
}

function needsSeparatorBefore(map: ComposerTextMap, offset: number): boolean {
  return offset > 0 && !/\s/.test(map.text[offset - 1] ?? " ");
}

export function planInsertText(
  map: ComposerTextMap,
  selection: ComposerSelection,
  text: string,
  separate: boolean,
): ComposerEdit {
  const separator = separate && needsSeparatorBefore(map, selection.start);
  const content = segmentsForInsert(text, selection.start === 0 && !separator);
  return {
    start: selection.start,
    end: selection.end,
    content: separator ? [{ type: "text", text: " " }, ...content] : content,
  };
}

export function planInsertAttachment(map: ComposerTextMap, selection: ComposerSelection, path: string): ComposerEdit {
  const content: ComposerSegment[] = [
    { type: "attachment", path },
    { type: "text", text: " " },
  ];
  if (needsSeparatorBefore(map, selection.start)) content.unshift({ type: "text", text: " " });
  return { start: selection.start, end: selection.end, content };
}

export function planReplaceAll(map: ComposerTextMap, text: string): ComposerEdit {
  return { start: 0, end: map.text.length, content: segmentsForInsert(text, true) };
}

export function planSkillAtStart(map: ComposerTextMap, name: string): ComposerEdit {
  const first = map.runs[0];
  const leadingSkill =
    first?.kind === "atom" && first.node instanceof HTMLElement && first.node.hasAttribute(SKILL_ATTR);
  let end = leadingSkill ? first.value.length : 0;
  if (leadingSkill && map.text[end] === " ") end += 1;
  return {
    start: 0,
    end,
    content: [
      { type: "skill", name },
      { type: "text", text: " " },
    ],
  };
}

function queryEnd(map: ComposerTextMap, caret: number, quoted: boolean): number {
  return quoted && map.text[caret] === '"' ? caret + 1 : caret;
}

export function planCompleteQuery(
  map: ComposerTextMap,
  selection: ComposerSelection,
  query: AtQueryMatch,
  entryPath: string,
  isDir: boolean,
): ComposerEdit | null {
  if (selection.start !== selection.end || map.text[query.start] !== "@" || query.start > selection.start) return null;
  const end = queryEnd(map, selection.start, query.quoted);
  if (!isDir) {
    return {
      start: query.start,
      end,
      content: [
        { type: "attachment", path: entryPath },
        { type: "text", text: " " },
      ],
    };
  }
  const insertion = buildAtInsertText(entryPath, true, query.quoted);
  return {
    start: query.start,
    end,
    content: [{ type: "text", text: insertion.text }],
    caretFromEnd: insertion.text.length - insertion.cursorOffset,
  };
}

export function planCloseTypedReference(map: ComposerTextMap, selection: ComposerSelection): ComposerEdit | null {
  if (selection.start !== selection.end) return null;
  const before = map.masked.slice(0, selection.start);
  const skill = findLeadingSkillCommand(before);
  if (skill && skill.end === before.length) {
    return {
      start: 0,
      end: skill.end,
      content: [
        { type: "skill", name: skill.name },
        { type: "text", text: " " },
      ],
    };
  }
  const query = extractAtQuery(before);
  if (!query || !query.query || !looksLikePath(query.query)) return null;
  return {
    start: query.start,
    end: queryEnd(map, selection.start, query.quoted),
    content: [
      { type: "attachment", path: query.query },
      { type: "text", text: " " },
    ],
  };
}

export function planRemoveChip(map: ComposerTextMap, chip: HTMLElement): ComposerEdit | null {
  const run = map.runs.find((candidate) => candidate.kind === "atom" && candidate.node === chip);
  if (!run) return null;
  let start = run.start;
  let end = run.start + run.value.length;
  if (map.text[end] === " ") end += 1;
  else if (map.text[start - 1] === " ") start -= 1;
  return { start, end, content: [] };
}

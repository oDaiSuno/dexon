import {
  attachmentTokenName,
  attachmentTokenText,
  findAttachmentTokens,
  isImagePath,
  segmentByAttachmentTokens,
} from "@shared/attachment-tokens";
import { findLeadingSkillCommand, skillCommandText } from "@shared/skill-commands";

/**
 * Pure DOM helpers for the composer editable surface: chip construction,
 * DOM → serialized-value walking, and the flat-layout invariant. No React —
 * kept separate so ComposerEditable stays about wiring and event flow.
 *
 * Two chip kinds live on the same flat surface: attachment tokens
 * (`@path`, data-attachment-token) and skill commands (`/skill:name`,
 * data-skill-token — pi expands these at message start).
 */

export const TOKEN_ATTR = "data-attachment-token";
export const SKILL_ATTR = "data-skill-token";

/** Selector matching any atomic chip on the editable surface. */
export const CHIP_SELECTOR = `[${TOKEN_ATTR}],[${SKILL_ATTR}]`;

export function tokenChipSvg(path: string): string {
  return isImagePath(path)
    ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.8" cy="8.8" r="1.7"/><path d="m21 15.5-4.2-4.2a1.5 1.5 0 0 0-2.1 0L5 21"/></svg>`
    : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

const SKILL_CHIP_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="7.5" x2="16.5" y1="4.5" y2="9.5"/></svg>`;

const CHIP_REMOVE_SVG = `<svg width="6" height="6" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="1" y1="1" x2="7" y2="7"/><line x1="7" y1="1" x2="1" y2="7"/></svg>`;

/** Serialized length of a chip's text form (caret-offset math on the flat DOM). */
export function chipSerializedLength(el: HTMLElement): number {
  if (el.hasAttribute(SKILL_ATTR)) return skillCommandText(el.dataset.skillName ?? "").length;
  if (el.hasAttribute(TOKEN_ATTR)) return attachmentTokenText(el.dataset.path ?? "").length;
  return 0;
}

export function isChipEl(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && (node.hasAttribute(TOKEN_ATTR) || node.hasAttribute(SKILL_ATTR));
}

/** DOM → serialized value. Text nodes verbatim; chips map to their text forms. */
function serializeChip(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push((node.textContent ?? "").replace(/\u00a0/g, " "));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  if (el.hasAttribute(SKILL_ATTR)) {
    out.push(skillCommandText(el.dataset.skillName ?? ""));
    return;
  }
  if (el.hasAttribute(TOKEN_ATTR)) {
    out.push(attachmentTokenText(el.dataset.path ?? ""));
    return;
  }
  if (el.tagName === "BR") {
    out.push("\n");
    return;
  }
  // Stray block containers (default Enter/paste before normalization): the
  // block boundary starts a new line.
  if (el.tagName === "DIV" || el.tagName === "P") out.push("\n");
  for (const child of Array.from(el.childNodes)) serializeChip(child, out);
}

export function serializeEditor(el: HTMLElement): string {
  const out: string[] = [];
  for (const child of Array.from(el.childNodes)) serializeChip(child, out);
  return out.join("");
}

/** Place a collapsed caret `offset` serialized characters into the flat DOM. */
export function placeCaretByOffset(el: HTMLElement, caretOffset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let remaining = caretOffset;
  let placed = false;
  const children = Array.from(el.childNodes);
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const size =
      child.nodeType === Node.TEXT_NODE ? (child.textContent ?? "").length : chipSerializedLength(child as HTMLElement);
    if (remaining <= size) {
      range.setStart(
        child.nodeType === Node.TEXT_NODE ? child : el,
        child.nodeType === Node.TEXT_NODE ? remaining : index,
      );
      range.collapse(true);
      placed = true;
      break;
    }
    remaining -= size;
  }
  if (!placed) {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Text-length of every node before the caret's child position (flat layout). */
function nodeSizeBefore(children: ChildNode[], index: number): number {
  let size = 0;
  for (let i = 0; i < index; i++) {
    const child = children[i];
    size +=
      child.nodeType === Node.TEXT_NODE ? (child.textContent ?? "").length : chipSerializedLength(child as HTMLElement);
  }
  return size;
}

/** Whether the caret sits directly after the given serialized offset. */
export function caretAtOffset(el: HTMLElement, caretOffset: number): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.anchorNode || !el.contains(sel.anchorNode)) return false;
  if (sel.anchorNode === el) {
    return nodeSizeBefore(Array.from(el.childNodes), sel.anchorOffset) === caretOffset;
  }
  const index = Array.from(el.childNodes).indexOf(sel.anchorNode as ChildNode);
  if (index < 0 || sel.anchorNode.nodeType !== Node.TEXT_NODE) return false;
  return nodeSizeBefore(Array.from(el.childNodes), index) + sel.anchorOffset === caretOffset;
}

export interface MaterializePlanEntry {
  start: number;
  end: number;
  chip: HTMLElement;
}

/**
 * Chips to materialize right now: a leading closed `/skill:name` still in
 * plain text, plus closed @tokens that still sit inside plain text nodes.
 * Open trailing queries stay literal so AtMenu/slash completion keep
 * replacing them. Empty plan = nothing to do.
 */
export function buildMaterializePlan(
  text: string,
  el: HTMLElement,
  createAttachmentChip: (path: string) => HTMLElement,
  createSkillChipEl: (name: string) => HTMLElement,
): MaterializePlanEntry[] {
  const plan: MaterializePlanEntry[] = [];
  const skill = findLeadingSkillCommand(text);
  const skillClosed = skill !== null && /\s/.test(text[skill.end] ?? "");
  const firstChild = el.firstChild;
  const skillIsPlainText = skillClosed && !(firstChild instanceof HTMLElement && firstChild.hasAttribute(SKILL_ATTR));
  if (skill && skillIsPlainText) {
    plan.push({ start: 0, end: skill.end, chip: createSkillChipEl(skill.name) });
  }
  const closed = findAttachmentTokens(text).filter((token) => /\s/.test(text[token.end] ?? ""));
  if (closed.length > 0) {
    // Only rewrite when a closed token still sits inside a plain text node
    // (chips serialize their token text, so they always match too).
    let offset = 0;
    for (const child of Array.from(el.childNodes)) {
      const size =
        child.nodeType === Node.TEXT_NODE
          ? (child.textContent ?? "").length
          : chipSerializedLength(child as HTMLElement);
      if (
        child.nodeType === Node.TEXT_NODE &&
        closed.some((token) => token.start < offset + size && token.end > offset)
      ) {
        for (const token of closed) {
          plan.push({ start: token.start, end: token.end, chip: createAttachmentChip(token.path) });
        }
        break;
      }
      offset += size;
    }
  }
  return plan;
}

/** Serialized text between the editor start and the caret (empty if invalid). */
export function textBeforeCaret(el: HTMLElement | null): string {
  const sel = window.getSelection();
  if (!el || !sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return "";
  const anchor = sel.anchorNode;
  if (!anchor) return "";
  const range = document.createRange();
  range.selectNodeContents(el);
  range.setEnd(anchor, sel.anchorOffset);
  return range.toString();
}

/**
 * A range covering the `prefixLength` serialized characters before the caret,
 * optionally swallowing one following closing quote (quoted @-completions).
 * Returns null when the caret is not collapsed in a text node with enough
 * characters before it.
 */
export function deleteRangeBeforeCaret(prefixLength: number, swallowFollowingQuote: boolean): Range | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return null;
  if (range.startContainer.nodeType !== Node.TEXT_NODE || range.startOffset < prefixLength) return null;
  const deleteRange = range.cloneRange();
  deleteRange.setStart(range.startContainer, range.startOffset - prefixLength);
  if (swallowFollowingQuote && range.startContainer.textContent?.[range.startOffset] === '"') {
    deleteRange.setEnd(range.startContainer, range.startOffset + 1);
  }
  return deleteRange;
}

/** Whether the char before the caret is non-whitespace (needs a glue space). */
export function needsGlueSpace(range: Range): boolean {
  const { startContainer, startOffset } = range;
  if (startContainer.nodeType === Node.TEXT_NODE) {
    return startOffset > 0 && !/\s/.test(startContainer.textContent?.[startOffset - 1] ?? " ");
  }
  const prev = startContainer.childNodes[startOffset - 1] ?? null;
  return prev !== null && !(prev.nodeType === Node.TEXT_NODE && /\s$/.test(prev.textContent ?? ""));
}

/** Clamp the editor's visual height to its max-height (auto-grow). */
export function syncEditorHeight(el: HTMLElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}

/** Collapse the caret to the editor end (after rebuild/programmatic edits). */
export function caretToEditorEnd(el: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Insert nodes at the caret (or editor end); glue a separator space when the
 * char before the caret is not whitespace; caret collapses after `caretNode`
 * (at `caretOffset` inside it).
 */
export function insertNodesAtCaret(el: HTMLElement, nodes: Node[], caretNode: Node | null, caretOffset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  el.focus();
  let range = sel.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
  if (!range) {
    caretToEditorEnd(el);
    range = sel.getRangeAt(0);
  }
  if (!range.collapsed) range.collapse(false);
  const frag = document.createDocumentFragment();
  if (needsGlueSpace(range)) frag.append(document.createTextNode(" "));
  frag.append(...nodes);
  range.insertNode(frag);
  if (caretNode) {
    const after = document.createRange();
    try {
      after.setStart(caretNode, caretOffset);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    } catch {
      caretToEditorEnd(el);
    }
  }
}

/** Refresh attachment chip visuals after async previews/missing state change. */
export function syncChipVisuals(
  el: HTMLElement,
  visualFor: (path: string) => PillVisual,
  previewsByPath: ReadonlyMap<string, string | null>,
  missingByPath: ReadonlyMap<string, boolean>,
): void {
  for (const chip of Array.from(el.querySelectorAll<HTMLElement>(`[${TOKEN_ATTR}]`))) {
    const path = chip.dataset.path ?? "";
    const preview = previewsByPath.get(path) ?? null;
    const missing = missingByPath.get(path) ?? false;
    if ((chip.dataset.previewKey ?? "") === (preview ?? "") && chip.dataset.missingKey === (missing ? "1" : "0")) {
      continue;
    }
    chip.dataset.previewKey = preview ?? "";
    chip.dataset.missingKey = missing ? "1" : "0";
    fillChipContent(chip, path, visualFor(path));
  }
}

/** Remove a chip atomically, collapsing one adjacent separator space, and
 *  leave the caret where the chip stood. */
export function removeChipNode(el: HTMLElement, chip: HTMLElement): void {
  const next = chip.nextSibling;
  const prev = chip.previousSibling;
  if (next?.nodeType === Node.TEXT_NODE && next.textContent?.startsWith(" ")) {
    next.textContent = next.textContent.slice(1);
  } else if (prev?.nodeType === Node.TEXT_NODE && prev.textContent?.endsWith(" ")) {
    prev.textContent = prev.textContent.slice(0, -1);
  }
  const index = Array.from(el.childNodes).indexOf(chip);
  chip.remove();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.setStart(el, Math.max(0, Math.min(index, el.childNodes.length)));
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/**
 * Place (or replace) a skill chip at message start. Skill commands are
 * expanded by pi only at position 0, so picking a skill always targets the
 * start of the message, not the caret. The caret collapses after the
 * separator space.
 */
export function insertSkillChipAtStart(el: HTMLElement, chip: HTMLElement): void {
  // Replace an existing leading skill chip instead of stacking two.
  const first = el.firstChild;
  if (isChipEl(first) && first.hasAttribute(SKILL_ATTR)) first.remove();
  const space = document.createTextNode(" ");
  const frag = document.createDocumentFragment();
  frag.append(chip, space);
  el.insertBefore(frag, el.firstChild);
  // Collapse one adjacent following space to avoid double gaps.
  if (space.nextSibling?.nodeType === Node.TEXT_NODE && space.nextSibling.textContent?.startsWith(" ")) {
    space.nextSibling.textContent = space.nextSibling.textContent.slice(1);
  }
  const after = document.createRange();
  after.setStart(space, 1);
  after.collapse(true);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(after);
  }
}

/** Insert a chip + separator space over a just-deleted query range; caret
 *  collapses after the space. */
export function insertChipWithSpace(deleteRange: Range, chip: HTMLElement): void {
  const space = document.createTextNode(" ");
  const frag = document.createDocumentFragment();
  frag.append(chip, space);
  deleteRange.insertNode(frag);
  const after = document.createRange();
  after.setStart(space, 1);
  after.collapse(true);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(after);
  }
}

/** Canonical layout invariant: only text nodes and chips, directly inside. */
export function isFlat(el: HTMLElement): boolean {
  return Array.from(el.childNodes).every((child) => child.nodeType === Node.TEXT_NODE || isChipEl(child));
}

export interface PillVisual {
  isImage: boolean;
  previewUrl: string | null;
  missing: boolean;
  title: string;
  removeLabel: string;
}

/** Build an atomic attachment chip element for the editable surface. */
export function createTokenChip(path: string, visual: PillVisual): HTMLElement {
  const chip = document.createElement("span");
  chip.setAttribute(TOKEN_ATTR, "");
  chip.dataset.path = path;
  chip.contentEditable = "false";
  chip.setAttribute("role", "button");
  fillChipContent(chip, path, visual);
  return chip;
}

export function fillChipContent(chip: HTMLElement, path: string, visual: PillVisual): void {
  chip.className = "token-chip" + (visual.missing ? " token-chip-missing" : "");
  chip.title = visual.title;
  chip.innerHTML = "";
  const icon = document.createElement(visual.isImage && visual.previewUrl ? "img" : "span");
  if (visual.isImage && visual.previewUrl) {
    (icon as HTMLImageElement).src = visual.previewUrl;
    (icon as HTMLImageElement).alt = "";
    icon.className = "token-chip-thumb";
  } else {
    icon.className = "token-chip-glyph";
    icon.innerHTML = tokenChipSvg(path);
  }
  const name = document.createElement("span");
  name.className = "token-chip-name";
  name.textContent = attachmentTokenName(path);
  const remove = document.createElement("span");
  remove.className = "token-chip-remove";
  remove.setAttribute("data-chip-remove", "");
  remove.setAttribute("role", "button");
  remove.title = visual.removeLabel;
  remove.innerHTML = CHIP_REMOVE_SVG;
  chip.append(icon, name, remove);
}

export interface SkillChipVisual {
  description: string | null;
  removeLabel: string;
}

/** Build an atomic `/skill:name` chip (accent-blue, per the reference design). */
export function createSkillChip(name: string, visual: SkillChipVisual): HTMLElement {
  const chip = document.createElement("span");
  chip.setAttribute(SKILL_ATTR, "");
  chip.dataset.skillName = name;
  chip.contentEditable = "false";
  chip.setAttribute("role", "button");
  chip.className = "skill-chip";
  chip.title = visual.description ?? skillCommandText(name);
  const icon = document.createElement("span");
  icon.className = "skill-chip-glyph";
  icon.innerHTML = SKILL_CHIP_SVG;
  const nameSpan = document.createElement("span");
  nameSpan.className = "skill-chip-name";
  nameSpan.textContent = name;
  const remove = document.createElement("span");
  remove.className = "token-chip-remove";
  remove.setAttribute("data-chip-remove", "");
  remove.setAttribute("role", "button");
  remove.title = visual.removeLabel;
  remove.innerHTML = CHIP_REMOVE_SVG;
  chip.append(icon, nameSpan, remove);
  return chip;
}

export type ComposerSegment =
  { type: "text"; text: string } | { type: "attachment"; path: string } | { type: "skill"; name: string };

/**
 * Unified segmenting for rebuild: attachment tokens anywhere, plus a leading
 * closed `/skill:name` (the only position pi expands). An open trailing
 * skill query stays plain text so the slash palette keeps working.
 */
export function segmentComposerText(text: string): ComposerSegment[] {
  const out: ComposerSegment[] = [];
  let rest = text;
  const skill = findLeadingSkillCommand(text);
  if (skill && /\s/.test(text[skill.end] ?? "")) {
    out.push({ type: "skill", name: skill.name });
    rest = text.slice(skill.end);
  }
  for (const segment of segmentByAttachmentTokens(rest)) {
    if (segment.type === "text") out.push({ type: "text", text: segment.text });
    else out.push({ type: "attachment", path: segment.token.path });
  }
  return out;
}

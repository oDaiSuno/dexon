import { attachmentTokenName, attachmentTokenText, isImagePath } from "@shared/attachment-tokens";

/**
 * Pure DOM helpers for the composer editable surface: chip construction,
 * DOM → serialized-value walking, and the flat-layout invariant. No React —
 * kept separate so ComposerEditable stays about wiring and event flow.
 */

export const TOKEN_ATTR = "data-attachment-token";

export function tokenChipSvg(path: string): string {
  return isImagePath(path)
    ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.8" cy="8.8" r="1.7"/><path d="m21 15.5-4.2-4.2a1.5 1.5 0 0 0-2.1 0L5 21"/></svg>`
    : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

const CHIP_REMOVE_SVG = `<svg width="6" height="6" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="1" y1="1" x2="7" y2="7"/><line x1="7" y1="1" x2="1" y2="7"/></svg>`;

/** DOM → serialized value. Text nodes verbatim; chips map to token text. */
function serializeChip(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push((node.textContent ?? "").replace(/\u00a0/g, " "));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;
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

/** Canonical layout invariant: only text nodes and chips, directly inside. */
export function isFlat(el: HTMLElement): boolean {
  return Array.from(el.childNodes).every(
    (child) =>
      child.nodeType === Node.TEXT_NODE ||
      (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).hasAttribute(TOKEN_ATTR)),
  );
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

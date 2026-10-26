import {
  attachmentTokenName,
  attachmentTokenText,
  insertAttachmentToken,
  segmentByAttachmentTokens,
} from "@shared/attachment-tokens";
import { attachmentGlyphSvg, SKILL_CHIP_SVG } from "./chip-glyphs";
import { findLeadingSkillCommand, skillCommandText, splitLeadingSkillCommand } from "@shared/skill-commands";

/**
 * Pure DOM helpers for the composer editable surface: chip construction. No
 * React — kept separate so ComposerEditable stays about wiring and event flow.
 *
 * Two chip kinds live on the same surface: attachment tokens
 * (`@path`, data-attachment-token) and skill commands (`/skill:name`,
 * data-skill-token — pi expands these at message start).
 */

export const TOKEN_ATTR = "data-attachment-token";
export const SKILL_ATTR = "data-skill-token";

/** Selector matching any atomic chip on the editable surface. */
export const CHIP_SELECTOR = `[${TOKEN_ATTR}],[${SKILL_ATTR}]`;

export function insertSerializedText(value: string, text: string): string {
  const glue = value.length > 0 && !/\s/.test(value[value.length - 1] ?? " ") ? " " : "";
  return `${value}${glue}${text}`;
}

export function insertSerializedAttachment(value: string, path: string): string {
  return insertAttachmentToken(value, null, path).value;
}

export function insertSerializedSkill(value: string, name: string): string {
  const rest = splitLeadingSkillCommand(value)?.rest ?? value;
  return `${skillCommandText(name)}${rest ? (/^\s/.test(rest) ? rest : ` ${rest}`) : " "}`;
}

const CHIP_REMOVE_SVG = `<svg width="6" height="6" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="1" y1="1" x2="7" y2="7"/><line x1="7" y1="1" x2="1" y2="7"/></svg>`;

export function chipText(el: HTMLElement): string {
  if (el.hasAttribute(SKILL_ATTR)) return skillCommandText(el.dataset.skillName ?? "");
  if (el.hasAttribute(TOKEN_ATTR)) return attachmentTokenText(el.dataset.path ?? "");
  return "";
}

export function isChipEl(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && (node.hasAttribute(TOKEN_ATTR) || node.hasAttribute(SKILL_ATTR));
}

/** Clamp the editor's visual height to its max-height (auto-grow). */
export function syncEditorHeight(el: HTMLElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
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
  chip.className = "token-chip type-mono-label" + (visual.missing ? " token-chip-missing" : "");
  chip.title = visual.title;
  chip.innerHTML = "";
  const icon = document.createElement(visual.isImage && visual.previewUrl ? "img" : "span");
  if (visual.isImage && visual.previewUrl) {
    (icon as HTMLImageElement).src = visual.previewUrl;
    (icon as HTMLImageElement).alt = "";
    icon.className = "token-chip-thumb";
  } else {
    icon.className = "token-chip-glyph";
    icon.innerHTML = attachmentGlyphSvg(path);
  }
  const name = document.createElement("span");
  name.className = "token-chip-name";
  name.textContent = attachmentTokenName(path);
  const remove = document.createElement("span");
  remove.className = "token-chip-remove";
  remove.setAttribute("data-chip-remove", "");
  remove.setAttribute("role", "button");
  remove.title = visual.removeLabel;
  remove.setAttribute("aria-label", visual.removeLabel);
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
  chip.className = "skill-chip type-label-medium";
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
  remove.setAttribute("aria-label", visual.removeLabel);
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

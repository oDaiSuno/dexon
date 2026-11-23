import {
  decodeComposerQuoteToken,
  encodeComposerQuoteToken,
  quoteSnippet,
  segmentByComposerQuoteTokens,
  type QuoteReference,
} from "@shared/quote-tokens";
import { QUOTE_CHIP_SVG } from "./quote-glyph";
import {
  attachmentTokenName,
  attachmentTokenText,
  insertAttachmentToken,
  segmentByAttachmentTokens,
} from "@shared/attachment-tokens";
import { attachmentGlyphSvg, SKILL_CHIP_SVG } from "./chip-glyphs";
import { findLeadingSkillCommand, skillCommandText } from "@shared/skill-commands";

export const TOKEN_ATTR = "data-attachment-token";
export const SKILL_ATTR = "data-skill-token";
export const QUOTE_ATTR = "data-quote-token";

export const CHIP_SELECTOR = `[${TOKEN_ATTR}],[${SKILL_ATTR}],[${QUOTE_ATTR}]`;

export function insertSerializedText(value: string, text: string): string {
  const glue = value.length > 0 && !/\s/.test(value[value.length - 1] ?? " ") ? " " : "";
  return `${value}${glue}${text}`;
}

export function insertSerializedAttachment(value: string, path: string): string {
  return insertAttachmentToken(value, null, path).value;
}

export function insertSerializedQuote(value: string, quote: QuoteReference): string {
  return `${insertSerializedText(value, encodeComposerQuoteToken(quote))} `;
}

const CHIP_REMOVE_SVG = `<svg width="6" height="6" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="1" y1="1" x2="7" y2="7"/><line x1="7" y1="1" x2="1" y2="7"/></svg>`;

export function chipText(el: HTMLElement): string {
  if (el.hasAttribute(QUOTE_ATTR)) {
    const quote = decodeComposerQuoteToken(el.dataset.quotePayload ?? "");
    return quote ? encodeComposerQuoteToken(quote) : "";
  }
  if (el.hasAttribute(SKILL_ATTR)) return skillCommandText(el.dataset.skillName ?? "");
  if (el.hasAttribute(TOKEN_ATTR)) return attachmentTokenText(el.dataset.path ?? "");
  return "";
}

export function isChipEl(node: Node | null): node is HTMLElement {
  return (
    node instanceof HTMLElement &&
    (node.hasAttribute(TOKEN_ATTR) || node.hasAttribute(SKILL_ATTR) || node.hasAttribute(QUOTE_ATTR))
  );
}

export function syncEditorHeight(el: HTMLElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}

export interface ChipVisuals {
  attachment(path: string): PillVisual;
  skill(name: string): SkillChipVisual;
  quote(quote: QuoteReference): QuoteChipVisual;
}

export function syncChipVisuals(el: HTMLElement, visuals: ChipVisuals): void {
  for (const chip of el.querySelectorAll<HTMLElement>(`[${QUOTE_ATTR}]`)) {
    const quote = decodeComposerQuoteToken(chip.dataset.quotePayload ?? "");
    if (quote) syncQuoteChipVisual(chip, visuals.quote(quote));
  }
  for (const chip of el.querySelectorAll<HTMLElement>(`[${TOKEN_ATTR}]`)) {
    const path = chip.dataset.path ?? "";
    const visual = visuals.attachment(path);
    if (chip.dataset.visualKey !== JSON.stringify(visual)) fillChipContent(chip, path, visual);
  }
  for (const chip of el.querySelectorAll<HTMLElement>(`[${SKILL_ATTR}]`)) {
    const name = chip.dataset.skillName ?? "";
    syncSkillChipVisual(chip, name, visuals.skill(name));
  }
}

export interface PillVisual {
  isImage: boolean;
  previewUrl: string | null;
  missing: boolean;
  title: string;
  removeLabel: string;
}

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
  chip.dataset.visualKey = JSON.stringify(visual);
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

export function createSkillChip(name: string, visual: SkillChipVisual): HTMLElement {
  const chip = document.createElement("span");
  chip.setAttribute(SKILL_ATTR, "");
  chip.dataset.skillName = name;
  chip.contentEditable = "false";
  chip.setAttribute("role", "button");
  chip.className = "skill-chip type-label-medium";
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
  syncSkillChipVisual(chip, name, visual);
  return chip;
}

function syncSkillChipVisual(chip: HTMLElement, name: string, visual: SkillChipVisual): void {
  chip.title = visual.description ?? skillCommandText(name);
  const remove = chip.querySelector<HTMLElement>("[data-chip-remove]");
  if (remove) {
    remove.title = visual.removeLabel;
    remove.setAttribute("aria-label", visual.removeLabel);
  }
}

export interface QuoteChipVisual {
  removeLabel: string;
}

function syncQuoteChipVisual(chip: HTMLElement, visual: QuoteChipVisual): void {
  const remove = chip.querySelector<HTMLElement>("[data-chip-remove]");
  if (remove) {
    remove.title = visual.removeLabel;
    remove.setAttribute("aria-label", visual.removeLabel);
  }
}

export function createQuoteChip(quote: QuoteReference, visual: QuoteChipVisual): HTMLElement {
  const chip = document.createElement("span");
  chip.setAttribute(QUOTE_ATTR, "");
  chip.dataset.quotePayload = encodeComposerQuoteToken(quote);
  chip.contentEditable = "false";
  chip.setAttribute("role", "button");
  chip.setAttribute("aria-label", quoteSnippet(quote.text));
  chip.className = "quote-chip type-label-medium";
  const icon = document.createElement("span");
  icon.className = "quote-chip-glyph";
  icon.innerHTML = QUOTE_CHIP_SVG;
  const name = document.createElement("span");
  name.className = "token-chip-name";
  name.textContent = quoteSnippet(quote.text);
  const remove = document.createElement("span");
  remove.className = "token-chip-remove";
  remove.setAttribute("data-chip-remove", "");
  remove.setAttribute("role", "button");
  remove.innerHTML = CHIP_REMOVE_SVG;
  chip.append(icon, name, remove);
  syncQuoteChipVisual(chip, visual);
  return chip;
}

export type ComposerSegment =
  | { type: "text"; text: string }
  | { type: "attachment"; path: string }
  | { type: "skill"; name: string }
  | { type: "quote"; quote: QuoteReference };

export function segmentComposerText(text: string): ComposerSegment[] {
  const out: ComposerSegment[] = [];
  let rest = text;
  const skill = findLeadingSkillCommand(text);
  if (skill && /\s/.test(text[skill.end] ?? "")) {
    out.push({ type: "skill", name: skill.name });
    rest = text.slice(skill.end);
  }
  for (const segment of segmentByComposerQuoteTokens(rest)) {
    if (segment.type === "quote") out.push(segment);
    else
      for (const part of segmentByAttachmentTokens(segment.text)) {
        if (part.type === "text") out.push(part);
        else out.push({ type: "attachment", path: part.token.path });
      }
  }
  return out;
}

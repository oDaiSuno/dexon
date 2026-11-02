import { isValidSkillName, skillCommandText, SKILL_COMMAND_PREFIX } from "@shared/skill-commands";
import type { ComposerSegment } from "./composer-dom";
import { COMPOSER_MASK } from "./composer-text-map";

declare const skillNameBrand: unique symbol;

export type SkillName = string & { readonly [skillNameBrand]: true };

export function toSkillName(raw: string): SkillName | null {
  return isValidSkillName(raw) ? (raw as SkillName) : null;
}

export type SlashCompletion =
  { readonly kind: "command"; readonly name: string } | { readonly kind: "skill"; readonly name: SkillName };

export interface CaretContext {
  readonly before: string;
  readonly after: string;
}

export interface SlashQuery {
  readonly key: string;
  readonly raw: string;
  readonly needle: string;
  readonly scope: "all" | "skill";
}

export const SKILL_SCOPE_PREFIX = SKILL_COMMAND_PREFIX.slice(1);

export function leadingSlashTokenEnd(maskedText: string): number | null {
  const match = /^\/[^\s/\uFFFC]*/.exec(maskedText);
  if (!match) return null;
  const end = match[0].length;
  const next = maskedText.charAt(end);
  return next === "" || /\s/.test(next) || next === COMPOSER_MASK ? end : null;
}

export function parseSlashQuery(caret: CaretContext | null): SlashQuery | null {
  if (!caret || leadingSlashTokenEnd(caret.before) !== caret.before.length) return null;
  const next = caret.after.charAt(0);
  if (next !== "" && !/\s/.test(next) && next !== COMPOSER_MASK) return null;
  const raw = caret.before.slice(1);
  const key = raw.toLowerCase();
  return key.startsWith(SKILL_SCOPE_PREFIX)
    ? { key, raw, needle: key.slice(SKILL_SCOPE_PREFIX.length), scope: "skill" }
    : { key, raw, needle: key, scope: "all" };
}

export function completionSegments(completion: SlashCompletion, needsTrailingSpace = true): readonly ComposerSegment[] {
  const head: ComposerSegment =
    completion.kind === "skill"
      ? { type: "skill", name: completion.name }
      : { type: "text", text: `/${completion.name}` };
  return needsTrailingSpace ? [head, { type: "text", text: " " }] : [head];
}

export function fillSerializedCommandSlot(value: string, completion: SlashCompletion): string {
  const end = leadingSlashTokenEnd(value) ?? 0;
  const rest = value.slice(end);
  const head = completion.kind === "skill" ? skillCommandText(completion.name) : `/${completion.name}`;
  return `${head}${/^\s/.test(rest) ? "" : " "}${rest}`;
}

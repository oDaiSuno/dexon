/**
 * `/skill:name` command references — the serialized form of a skill chip in
 * the composer. Pi expands skill commands at message start before sending
 * (forcing the skill's SKILL.md to load), so the chip's text form must stay
 * exactly this command syntax and only the leading occurrence is a command.
 */

export const SKILL_COMMAND_PREFIX = "/skill:";

/** pi skill name rules: lowercase a-z / 0-9 / hyphens, no lead/trail/consecutive hyphens. */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_NAME_MAX = 64;

export interface SkillCommandMatch {
  name: string;
  start: number;
  /** Exclusive end offset in the source text (end of `/skill:name`). */
  end: number;
}

export function isValidSkillName(name: string): boolean {
  return name.length > 0 && name.length <= SKILL_NAME_MAX && SKILL_NAME_RE.test(name);
}

/**
 * The leading `/skill:name` in `text` (position 0 only — pi expands commands
 * at message start). Returns null while the name is still being typed into an
 * invalid state (bad characters, trailing hyphen). The name charset is
 * greedy, so the match ends at the first non-name character or end of text.
 */
export function findLeadingSkillCommand(text: string): SkillCommandMatch | null {
  if (!text.startsWith(SKILL_COMMAND_PREFIX)) return null;
  const match = /^[a-z0-9-]{1,64}(?=\s|$)/.exec(text.slice(SKILL_COMMAND_PREFIX.length));
  if (!match || !isValidSkillName(match[0])) return null;
  return { name: match[0], start: 0, end: SKILL_COMMAND_PREFIX.length + match[0].length };
}

/** Serialized text of a skill command reference. */
export function skillCommandText(name: string): string {
  return `${SKILL_COMMAND_PREFIX}${name}`;
}

/**
 * Split a message that starts with a skill command into the badge part and
 * the prose remainder (transcript rendering). The command counts as a badge
 * when followed by whitespace or end of text; `rest` keeps its leading
 * separator space.
 */
export function splitLeadingSkillCommand(text: string): { name: string; rest: string } | null {
  const match = findLeadingSkillCommand(text);
  if (!match) return null;
  const charAfter = text[match.end] ?? "";
  if (charAfter !== "" && !/\s/.test(charAfter)) return null;
  return { name: match.name, rest: text.slice(match.end) };
}

/**
 * Pi expands a leading `/skill:name args` into a `<skill>` block before the
 * message enters the session, so transcripts store — and pi echoes back —
 * the expanded form, not the command. Parse it back into the badge pair.
 * Requires the closing tag so hand-typed half-XML stays prose.
 */
const EXPANDED_SKILL_RE = /^<skill name="([^"]+)" location="[^"]*">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]*))?$/;

export function parseExpandedSkillMessage(text: string): { name: string; rest: string } | null {
  const match = EXPANDED_SKILL_RE.exec(text);
  if (!match || !isValidSkillName(match[1])) return null;
  return { name: match[1], rest: match[3] ?? "" };
}

import { isValidSkillName, skillCommandText, splitLeadingSkillCommand } from "./skill-commands";

export type PromptIntent =
  { kind: "prose"; text: string } | { kind: "skill"; name: string; goal: string } | { kind: "command"; text: string };

const EXPANDED_SKILL_RE = /^<skill name="([^"]+)" location="[^"]*">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]*))?$/;

export function readPromptIntent(text: string): PromptIntent {
  const typed = splitLeadingSkillCommand(text);
  if (typed) return { kind: "skill", name: typed.name, goal: typed.rest.trim() };
  const expanded = EXPANDED_SKILL_RE.exec(text);
  if (expanded && isValidSkillName(expanded[1])) {
    return { kind: "skill", name: expanded[1], goal: (expanded[3] ?? "").trim() };
  }
  return text.startsWith("/") ? { kind: "command", text } : { kind: "prose", text };
}

export function promptIntentText(intent: PromptIntent): string {
  if (intent.kind !== "skill") return intent.text;
  const command = skillCommandText(intent.name);
  return intent.goal ? `${command} ${intent.goal}` : command;
}

export const TITLE_SOURCE_MIN_CODE_POINTS = 2;

export interface TitleSource {
  goal: string;
  skill?: string;
}

export function titleSourceOf(intent: PromptIntent): TitleSource | null {
  if (intent.kind === "command") return null;
  const goal = (intent.kind === "skill" ? intent.goal : intent.text).trim();
  if ([...goal].length < TITLE_SOURCE_MIN_CODE_POINTS) return null;
  return intent.kind === "skill" ? { goal, skill: intent.name } : { goal };
}

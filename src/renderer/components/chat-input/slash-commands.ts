import type { SlashCommandInfo } from "@/hooks/useAgentSession";

export type SlashCommandPaletteItem =
  | SlashCommandInfo
  | {
      name: string;
      description: string;
      source: "builtin";
    };

/** Palette grouping sources. Skill commands are excluded — the ＋ menu's
 *  skill picker is the single path for invoking skills. */
export type SlashCommandSource = "builtin" | "extension" | "prompt";

export const BUILTIN_SLASH_COMMANDS: SlashCommandPaletteItem[] = [
  { name: "compact", description: "Compress context, optionally with instructions", source: "builtin" },
  { name: "reload", description: "Reload extensions, skills, prompts, and tools", source: "builtin" },
  { name: "name", description: "Set the session display name", source: "builtin" },
  { name: "session", description: "Show session message, token, and cost stats", source: "builtin" },
  { name: "copy", description: "Copy the last assistant message", source: "builtin" },
];

// Skill commands never reach the palette (filtered at load; the ＋ menu's
// skill picker is the single entry point), so "skill" is not a palette group.
export const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt"];

export const SLASH_SOURCE_GROUP_LABEL: Record<SlashCommandSource, string> = {
  builtin: "Built-in",
  extension: "Extensions",
  prompt: "Prompts",
};

export const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
};

export function slashMatchRank(command: SlashCommandPaletteItem, query: string): number {
  const name = command.name.toLowerCase();
  const description = command.description?.toLowerCase() ?? "";
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}

const SLASH_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareSlashCommands(a: SlashCommandPaletteItem, b: SlashCommandPaletteItem, query: string): number {
  const rankDelta = slashMatchRank(a, query) - slashMatchRank(b, query);
  if (rankDelta !== 0) return rankDelta;
  const orderOf = (item: SlashCommandPaletteItem): number =>
    SLASH_SOURCE_ORDER[item.source as SlashCommandSource] ?? 99;
  const orderDelta = orderOf(a) - orderOf(b);
  return orderDelta || SLASH_COLLATOR.compare(a.name, b.name);
}

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

export interface SlashCommandGroup {
  source: SlashCommandSource;
  items: { command: SlashCommandPaletteItem; index: number }[];
}

type Translate = (key: string, fallback: string) => string;

export function builtinSlashCommands(t: Translate): SlashCommandPaletteItem[] {
  return [
    {
      name: "compact",
      description: t("slashCompactDescription", "Compress context, optionally with instructions"),
      source: "builtin",
    },
    {
      name: "reload",
      description: t("slashReloadDescription", "Reload extensions, skills, prompts, and tools"),
      source: "builtin",
    },
    { name: "name", description: t("slashNameDescription", "Set the session display name"), source: "builtin" },
    {
      name: "session",
      description: t("slashSessionDescription", "Show session message, token, and cost stats"),
      source: "builtin",
    },
    { name: "copy", description: t("slashCopyDescription", "Copy the last assistant message"), source: "builtin" },
  ];
}

// Skill commands never reach the palette (filtered at load; the ＋ menu's
// skill picker is the single entry point), so "skill" is not a palette group.
export const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt"];

export function slashSourceLabel(source: SlashCommandSource, t: Translate): string {
  if (source === "builtin") return t("slashGroupBuiltin", "Built-in");
  if (source === "extension") return t("slashGroupExtensions", "Extensions");
  return t("slashGroupPrompts", "Prompts");
}

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
  if (orderDelta !== 0 || query === "") return orderDelta;
  return SLASH_COLLATOR.compare(a.name, b.name);
}

export function groupSlashCommands(commands: SlashCommandPaletteItem[]): SlashCommandGroup[] {
  return SLASH_SOURCES.map((source) => ({
    source,
    items: commands.flatMap((command, index) => (command.source === source ? [{ command, index }] : [])),
  })).filter((group) => group.items.length > 0);
}

export function slashSourcesInOrder(commands: SlashCommandPaletteItem[]): SlashCommandSource[] {
  const seen: SlashCommandSource[] = [];
  for (const command of commands) {
    const source = command.source as SlashCommandSource;
    if (SLASH_SOURCES.includes(source) && !seen.includes(source)) seen.push(source);
  }
  return seen;
}

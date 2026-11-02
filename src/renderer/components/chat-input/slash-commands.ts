import type { SessionCommandInfo } from "@/hooks/useAgentSession";
import { SKILL_SCOPE_PREFIX, type SkillName, type SlashCompletion, type SlashQuery } from "./command-slot";
import type { CatalogSkill } from "./use-skill-catalog";

export interface BuiltinCommand {
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
}

type SlashEntry =
  | {
      readonly kind: "command";
      readonly source: "builtin" | "extension" | "prompt";
      readonly name: string;
      readonly description: string;
      readonly argumentHint?: string;
    }
  | { readonly kind: "skill"; readonly source: "skill"; readonly name: SkillName; readonly description: string };

export type SlashSource = SlashEntry["source"];

interface SourceMeta {
  readonly order: number;
  readonly label: (t: Translate) => string;
}

const SOURCES = {
  builtin: { order: 0, label: (t) => t("slashGroupBuiltin", "Built-in") },
  extension: { order: 1, label: (t) => t("slashGroupExtensions", "Extensions") },
  prompt: { order: 2, label: (t) => t("slashGroupPrompts", "Prompts") },
  skill: { order: 3, label: (t) => t("slashGroupSkills", "Skills") },
} as const satisfies Record<SlashSource, SourceMeta>;

const SOURCE_ORDER = (Object.keys(SOURCES) as SlashSource[]).sort((a, b) => SOURCES[a].order - SOURCES[b].order);
const COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const TIER = { exact: 0, prefix: 1, wordPrefix: 2, substring: 3, description: 4 } as const;

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export interface SlashSuggestion {
  readonly id: string;
  readonly source: SlashSource;
  readonly label: string;
  readonly highlights: readonly TextSpan[];
  readonly description: string;
  readonly argumentHint?: string;
  readonly completion: SlashCompletion;
}

export interface SlashSources {
  readonly builtins: readonly BuiltinCommand[];
  readonly session: { readonly commands: readonly SessionCommandInfo[]; readonly loading: boolean };
  readonly skills: { readonly entries: readonly CatalogSkill[]; readonly loading: boolean };
}

export interface SlashSuggestions {
  readonly items: readonly SlashSuggestion[];
  readonly pending: boolean;
}

export interface SlashGroup {
  readonly source: SlashSource;
  readonly items: readonly { readonly item: SlashSuggestion; readonly index: number }[];
}

type Translate = (key: string, fallback: string) => string;

export function builtinSlashCommands(t: Translate): BuiltinCommand[] {
  return [
    {
      name: "compact",
      description: t("slashCompactDescription", "Compress context, optionally with instructions"),
      argumentHint: t("slashCompactArgument", "‹instructions›"),
    },
    { name: "reload", description: t("slashReloadDescription", "Reload extensions, skills, prompts, and tools") },
    {
      name: "name",
      description: t("slashNameDescription", "Set the session display name"),
      argumentHint: t("slashNameArgument", "‹name›"),
    },
    { name: "session", description: t("slashSessionDescription", "Show session message, token, and cost stats") },
    { name: "copy", description: t("slashCopyDescription", "Copy the last assistant message") },
  ];
}

export function suggestSlash(sources: SlashSources, query: SlashQuery): SlashSuggestions {
  const entries: SlashEntry[] = [
    ...sources.builtins.map((entry): SlashEntry => ({ ...entry, kind: "command", source: "builtin" })),
    ...sources.session.commands.map((entry): SlashEntry => ({
      ...entry,
      kind: "command",
      description: entry.description ?? "",
    })),
    ...sources.skills.entries.map((entry): SlashEntry => ({
      kind: "skill",
      source: "skill",
      name: entry.name,
      description: entry.description,
    })),
  ];
  const scored = entries.flatMap((entry, sequence) => {
    if (query.scope === "skill" && entry.kind !== "skill") return [];
    const match = matchEntry(entry, query.needle);
    return match ? [{ entry, match, sequence }] : [];
  });
  scored.sort(
    (a, b) =>
      a.match.tier - b.match.tier ||
      SOURCES[a.entry.source].order - SOURCES[b.entry.source].order ||
      (query.needle === "" ? 0 : COLLATOR.compare(labelOf(a.entry), labelOf(b.entry))) ||
      a.sequence - b.sequence,
  );
  const seen = new Set<string>();
  const items = scored.flatMap(({ entry, match }): SlashSuggestion[] => {
    const label = labelOf(entry);
    const id = `${entry.source}:${label}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        source: entry.source,
        label,
        highlights: match.highlights,
        description: entry.description,
        argumentHint: entry.kind === "command" ? entry.argumentHint : undefined,
        completion:
          entry.kind === "skill" ? { kind: "skill", name: entry.name } : { kind: "command", name: entry.name },
      },
    ];
  });
  return { items, pending: sources.session.loading || sources.skills.loading };
}

export function groupSlashSuggestions(items: readonly SlashSuggestion[]): SlashGroup[] {
  return SOURCE_ORDER.map((source) => ({
    source,
    items: items.flatMap((item, index) => (item.source === source ? [{ item, index }] : [])),
  })).filter((group) => group.items.length > 0);
}

export function slashSourcesOf(items: readonly SlashSuggestion[]): SlashSource[] {
  return SOURCE_ORDER.filter((source) => items.some((item) => item.source === source));
}

export function slashSourceLabel(source: SlashSource, t: Translate): string {
  return SOURCES[source].label(t);
}

interface EntryMatch {
  readonly tier: (typeof TIER)[keyof typeof TIER];
  readonly highlights: readonly TextSpan[];
}

function labelOf(entry: SlashEntry): string {
  return entry.kind === "skill" ? `${SKILL_SCOPE_PREFIX}${entry.name}` : entry.name;
}

function matchEntry(entry: SlashEntry, needle: string): EntryMatch | null {
  if (!needle) return { tier: TIER.exact, highlights: [] };
  const keys =
    entry.kind === "skill"
      ? [
          { text: entry.name, offset: SKILL_SCOPE_PREFIX.length },
          { text: labelOf(entry), offset: 0 },
        ]
      : [{ text: entry.name, offset: 0 }];
  let best: EntryMatch | null = null;
  for (const key of keys) {
    const match = rankText(key.text.toLowerCase(), needle);
    if (!match || (best && best.tier <= match.tier)) continue;
    best = {
      tier: match.tier,
      highlights: match.highlights.map((span) => ({ start: span.start + key.offset, end: span.end + key.offset })),
    };
  }
  return best ?? (entry.description.toLowerCase().includes(needle) ? { tier: TIER.description, highlights: [] } : null);
}

function rankText(text: string, needle: string): EntryMatch | null {
  const span = (start: number, tier: EntryMatch["tier"]): EntryMatch => ({
    tier,
    highlights: [{ start, end: start + needle.length }],
  });
  if (text === needle) return span(0, TIER.exact);
  if (text.startsWith(needle)) return span(0, TIER.prefix);
  const first = text.indexOf(needle);
  if (first < 0) return null;
  for (let at = first; at >= 0; at = text.indexOf(needle, at + 1)) {
    if (at > 0 && /[-:_]/.test(text[at - 1])) return span(at, TIER.wordPrefix);
  }
  return span(first, TIER.substring);
}

import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import { KeyHint } from "./SendControls";
import { MenuFooter, MenuHeader, MenuPanel, MenuState, SearchXIcon } from "./menu-chrome";
import {
  groupSlashCommands,
  slashSourceLabel,
  slashSourcesInOrder,
  type SlashCommandPaletteItem,
} from "./slash-commands";

const SKELETON_BARS: [number, number][] = [
  [72, 150],
  [64, 170],
  [56, 120],
  [84, 160],
  [60, 140],
  [70, 110],
];

const GRID_STYLE = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 2,
} as const;

/** / command palette: grouped card grid above the composer. Structure and
 *  keyboard behaviour are owned by ChatInput; this is presentation only. */
export function SlashMenu({
  commands,
  query,
  loading,
  activeIndex,
  itemRefs,
  onApply,
  onHover,
}: {
  commands: SlashCommandPaletteItem[];
  query: string;
  loading?: boolean;
  activeIndex: number;
  itemRefs: { current: (HTMLButtonElement | null)[] };
  onApply: (command: SlashCommandPaletteItem) => void;
  onHover: (index: number) => void;
}) {
  const { t } = useI18n();
  const isLoading = loading === true;
  const count = commands.length;
  const needle = query.toLowerCase();
  const filtering = needle !== "";
  const countLabel = isLoading
    ? "…"
    : filtering && count > 0
      ? count === 1
        ? t("slashOneMatch", "1 match")
        : t("slashMatchCount", "{count} matches").replace("{count}", String(count))
      : count === 1
        ? t("oneCommand", "1 command")
        : t("commandCount", "{count} commands").replace("{count}", String(count));

  const card = (command: SlashCommandPaletteItem, index: number) => (
    <SlashCommandCard
      key={`${command.source}:${command.name}`}
      command={command}
      query={needle}
      active={index === activeIndex}
      completeLabel={t("menuKeyComplete", "Complete")}
      buttonRef={(node) => {
        itemRefs.current[index] = node;
      }}
      onApply={() => onApply(command)}
      onHover={() => onHover(index)}
    />
  );

  let body: ReactNode;
  if (isLoading) {
    body = <SlashSkeleton label={t("loadingCommands", "Reading commands…")} />;
  } else if (count === 0) {
    body = (
      <MenuState
        icon={<SearchXIcon />}
        title={
          filtering
            ? t("noSlashCommandsFound", "No commands match “/{query}”").replace("{query}", query)
            : t("slashNoCommands", "No commands available")
        }
        description={t(
          "slashNoMatchHint",
          "Commands come from built-ins, extensions, and prompt templates; use the + at the bottom left for skills.",
        )}
      />
    );
  } else if (filtering) {
    const sources = slashSourcesInOrder(commands)
      .map((source) => slashSourceLabel(source, t))
      .join(" · ");
    body = (
      <div style={{ ...LIST_STYLE }}>
        <div style={GRID_STYLE}>{commands.map((command, index) => card(command, index))}</div>
        <div className="type-meta-default" style={{ padding: "6px 10px 0", color: "var(--fx-text-tertiary)" }}>
          {t("slashFromSources", "From {sources}").replace("{sources}", sources)}
        </div>
      </div>
    );
  } else {
    body = (
      <div style={LIST_STYLE}>
        {groupSlashCommands(commands).map((group) => (
          <section key={group.source} style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "var(--space-2) var(--space-2) var(--space-1)",
                color: "var(--fx-text-tertiary)",
              }}
            >
              <span className="type-meta-caps">{slashSourceLabel(group.source, t)}</span>
              <span className="type-mono-meta">{group.items.length}</span>
            </div>
            <div style={GRID_STYLE}>{group.items.map(({ command, index }) => card(command, index))}</div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <MenuPanel label={t("slashCommandsWithCount", "Slash commands · {count}").replace("{count}", countLabel)}>
      <MenuHeader
        sigil="/"
        title={isLoading ? t("loadingCommands", "Reading commands…") : t("slashMenuTitle", "Commands")}
        titleMuted={isLoading}
        query={isLoading ? undefined : query}
        count={countLabel}
      />
      {body}
      <MenuFooter
        hints={[
          { keyLabel: "↑↓", label: t("menuKeySelect", "Select") },
          { keyLabel: "tab / ↵", label: t("menuKeyComplete", "Complete") },
          { keyLabel: "esc", label: t("menuKeyClose", "Close") },
        ]}
        note={t("slashSkillsHint", "Skills are in the + menu")}
      />
    </MenuPanel>
  );
}

const LIST_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  maxHeight: 222,
  overflowY: "auto",
  overscrollBehavior: "contain",
  padding: "6px var(--space-2) 10px",
} as const;

function SlashCommandCard({
  command,
  query,
  active,
  completeLabel,
  buttonRef,
  onApply,
  onHover,
}: {
  command: SlashCommandPaletteItem;
  query: string;
  active: boolean;
  completeLabel: string;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onApply: () => void;
  onHover: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onApply();
      }}
      onMouseEnter={onHover}
      style={{
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "9px 10px",
        border: "none",
        borderRadius: "var(--radius-control)",
        background: active ? "var(--fx-surface-hover-overlay)" : "var(--fx-surface-hover-clear)",
        color: "var(--fx-text-primary)",
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
      }}
    >
      <span style={{ width: "100%", minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
        <span
          className="type-mono-label"
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          <HighlightedName name={command.name} query={query} />
        </span>
        {command.argumentHint && (
          <span
            className="type-mono-meta"
            style={{ flexShrink: 0, whiteSpace: "nowrap", color: "var(--fx-text-tertiary)" }}
          >
            {command.argumentHint}
          </span>
        )}
        <span aria-hidden style={{ flex: 1, minWidth: 0 }} />
        {active && <KeyHint keyLabel="↵" label={completeLabel} />}
      </span>
      {command.description && (
        <span
          className="type-label-default"
          style={{
            width: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--fx-text-tertiary)",
          }}
        >
          {command.description}
        </span>
      )}
    </button>
  );
}

function HighlightedName({ name, query }: { name: string; query: string }) {
  const at = query ? name.toLowerCase().indexOf(query) : -1;
  if (at < 0) return <>/{name}</>;
  const muted = { color: "var(--fx-text-secondary)" };
  return (
    <>
      <span style={muted}>/{name.slice(0, at)}</span>
      <span className="type-mono-label-strong">{name.slice(at, at + query.length)}</span>
      <span style={muted}>{name.slice(at + query.length)}</span>
    </>
  );
}

function SlashSkeleton({ label }: { label: string }) {
  return (
    <div className="motion-safe:animate-pulse" style={{ padding: "10px var(--space-2) var(--space-3)" }}>
      <span className="sr-only">{label}</span>
      <div aria-hidden style={GRID_STYLE}>
        {SKELETON_BARS.map(([title, description], index) => (
          <div
            key={index}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", padding: "11px 10px" }}
          >
            <span style={{ ...BAR_STYLE, width: title, height: 10 }} />
            <span style={{ ...BAR_STYLE, width: description, maxWidth: "100%", height: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const BAR_STYLE = {
  display: "block",
  borderRadius: "var(--radius-skeleton)",
  background: "var(--fx-surface-subtle)",
} as const;

import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import { KeyHint } from "./SendControls";
import { MenuFooter, MenuHeader, MenuPanel, MenuState, SearchXIcon } from "./menu-chrome";
import { PackageIcon } from "./icons";
import { SKILL_SCOPE_PREFIX } from "./command-slot";
import { groupSlashSuggestions, slashSourceLabel, slashSourcesOf, type SlashSuggestion } from "./slash-commands";
import type { SlashPaletteView } from "./use-slash-palette";

const SKELETON_BARS: [number, number][] = [
  [72, 150],
  [64, 170],
  [56, 120],
  [84, 160],
  [60, 140],
  [70, 110],
];
const GRID_STYLE = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 } as const;

export function SlashMenu({ view }: { view: SlashPaletteView }) {
  const { t } = useI18n();
  const { items, query, activeIndex, itemRefs } = view;
  const count = items.length;
  const isLoading = view.pending && count === 0;
  const filtering = query !== "";
  const activeItem = items[activeIndex];
  const completeLabel =
    activeItem?.source === "skill" ? t("slashKeyUseSkill", "Use skill") : t("menuKeyComplete", "Complete");
  const countLabel = isLoading
    ? "…"
    : filtering && count > 0
      ? count === 1
        ? t("slashOneMatch", "1 match")
        : t("slashMatchCount", "{count} matches").replace("{count}", String(count))
      : count === 1
        ? t("oneCommand", "1 command")
        : t("commandCount", "{count} commands").replace("{count}", String(count));
  const card = (item: SlashSuggestion, index: number) => (
    <SlashCommandCard
      key={item.id}
      item={item}
      active={index === activeIndex}
      completeLabel={item.source === "skill" ? t("slashKeyUseSkill", "Use skill") : t("menuKeyComplete", "Complete")}
      buttonRef={(node) => {
        itemRefs.current[index] = node;
      }}
      onApply={() => view.apply(item)}
      onHover={() => view.hover(index)}
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
            ? t("noSlashCommandsFound", "No commands or skills match “/{query}”").replace("{query}", query)
            : t("slashNoCommands", "No commands available")
        }
        description={t(
          "slashNoMatchHint",
          "Enter is blocked to prevent accidental send; press Backspace to edit, or Esc to close and send as plain text.",
        )}
      />
    );
  } else if (filtering) {
    const sources = slashSourcesOf(items);
    const sourceLine =
      sources.length === 1 && sources[0] === "skill" && view.scope === "all"
        ? t("slashFromSkillsBareMatch", "From Skills · matched by skill name (no skill: prefix needed)")
        : t("slashFromSources", "From {sources}").replace(
            "{sources}",
            sources.map((source) => slashSourceLabel(source, t)).join(" · "),
          );
    body = (
      <div style={LIST_STYLE}>
        <div style={GRID_STYLE}>{items.map(card)}</div>
        <div className="type-meta-default" style={{ padding: "6px 10px 0", color: "var(--fx-text-tertiary)" }}>
          {sourceLine}
        </div>
      </div>
    );
  } else {
    body = (
      <div style={LIST_STYLE}>
        {groupSlashSuggestions(items).map((group) => (
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
            <div style={GRID_STYLE}>{group.items.map(({ item, index }) => card(item, index))}</div>
          </section>
        ))}
      </div>
    );
  }
  const empty = !isLoading && count === 0;
  return (
    <MenuPanel label={t("slashCommandsWithCount", "Slash commands · {count}").replace("{count}", countLabel)}>
      <MenuHeader
        sigil="/"
        title={isLoading ? t("loadingCommands", "Reading commands…") : t("slashMenuTitle", "Commands & skills")}
        titleMuted={isLoading}
        query={isLoading ? undefined : query}
        note={
          view.pending && !isLoading ? (
            <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
              …
            </span>
          ) : undefined
        }
        count={countLabel}
      />
      {body}
      <MenuFooter
        hints={
          empty
            ? [
                { keyLabel: "⌫", label: t("slashKeyEditQuery", "Edit query") },
                { keyLabel: "esc", label: t("slashKeyDismissToSend", "Close to send") },
              ]
            : [
                { keyLabel: "↑↓←→", label: t("menuKeySelect", "Select") },
                { keyLabel: "tab / ↵", label: completeLabel },
                { keyLabel: "esc", label: t("menuKeyClose", "Close") },
              ]
        }
        note={
          empty
            ? t("slashEnterBlockedHint", "Enter blocked to prevent accidental send")
            : filtering
              ? t("slashReplaceLeadingHint", "Completes only the leading command")
              : t("slashSkillsHint", "Type /skill: to filter skills only")
        }
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
  padding: "6px 6px 10px",
} as const;

function SlashCommandCard({
  item,
  active,
  completeLabel,
  buttonRef,
  onApply,
  onHover,
}: {
  item: SlashSuggestion;
  active: boolean;
  completeLabel: string;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onApply: () => void;
  onHover: () => void;
}) {
  const skill = item.source === "skill";
  return (
    <button
      ref={buttonRef}
      type="button"
      onMouseDown={(event) => {
        event.preventDefault();
        onApply();
      }}
      onMouseEnter={onHover}
      style={{
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "8px 7px",
        border: active && skill ? "1px solid var(--fx-accent-blue-border)" : "1px solid transparent",
        boxSizing: "border-box",
        borderRadius: "var(--radius-control)",
        background: active
          ? skill
            ? "var(--fx-accent-blue-soft)"
            : "var(--fx-surface-hover-overlay)"
          : "var(--fx-surface-hover-clear)",
        color: "var(--fx-text-primary)",
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
      }}
    >
      <span style={{ width: "100%", minWidth: 0, display: "flex", alignItems: "center", gap: 4 }}>
        {skill && (
          <span style={{ display: "inline-flex", flexShrink: 0, color: "var(--fx-accent-blue-text)" }}>
            <PackageIcon size={12} />
          </span>
        )}
        <span
          className="type-mono-label"
          title={`/${item.label}`}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          <HighlightedLabel item={item} active={active} />
        </span>
        {item.argumentHint && (
          <span
            className="type-mono-meta"
            style={{ flexShrink: 0, whiteSpace: "nowrap", color: "var(--fx-text-tertiary)" }}
          >
            {item.argumentHint}
          </span>
        )}
        {active && (
          <span style={{ marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap" }}>
            <KeyHint keyLabel="↵" label={completeLabel} />
          </span>
        )}
      </span>
      {item.description && (
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
          {item.description}
        </span>
      )}
    </button>
  );
}

function HighlightedLabel({ item, active }: { item: SlashSuggestion; active: boolean }) {
  const skill = item.source === "skill";
  const boundaries = [
    ...new Set([
      0,
      item.label.length,
      ...(skill ? [SKILL_SCOPE_PREFIX.length] : []),
      ...item.highlights.flatMap((span) => [span.start, span.end]),
    ]),
  ].sort((a, b) => a - b);
  return (
    <>
      <span style={skill ? { color: "var(--fx-text-tertiary)" } : undefined}>/</span>
      {boundaries.slice(0, -1).map((start, index) => {
        const end = boundaries[index + 1];
        const matched = item.highlights.some((span) => start >= span.start && end <= span.end);
        const color = skill
          ? matched
            ? "var(--fx-accent-blue-text)"
            : start < SKILL_SCOPE_PREFIX.length
              ? "var(--fx-text-tertiary)"
              : active
                ? "var(--fx-accent-blue-text)"
                : "var(--fx-text-primary)"
          : !matched && item.highlights.length > 0
            ? "var(--fx-text-secondary)"
            : "var(--fx-text-primary)";
        return (
          <span key={start} className={matched ? "type-mono-label-strong" : undefined} style={{ color }}>
            {item.label.slice(start, end)}
          </span>
        );
      })}
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

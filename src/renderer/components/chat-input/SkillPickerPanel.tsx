import { Fragment, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { SkillRecord } from "@/lib/api-types";
import { GlideHighlight } from "./GlideHighlight";
import { Icon, PackageIcon } from "./icons";

/**
 * The ＋ menu's "Use a skill" second-level panel: browse installed skills
 * (via the skills.list RPC, fetched by ChatInput), filter by query, pick one
 * to place a `/skill:name` chip at message start. Shares the PlusMenu visual
 * skeleton: full-width panel rising from the composer's top edge, pop-in,
 * raised shadow, one line per row.
 */

/** Map a SkillRecord's source info to a scope label (mirrors SkillsConfig). */
function skillScope(skill: SkillRecord): "global" | "project" | "path" {
  const source = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || source === "user") return "global";
  if (scope === "project" || source === "project") return "project";
  return "path";
}

export function SkillPickerPanel({
  skills,
  loading,
  error,
  onPick,
  onClose,
}: {
  skills: SkillRecord[];
  loading: boolean;
  error: string | null;
  onPick: (skill: SkillRecord) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (skill) => skill.name.toLowerCase().includes(q) || (skill.description ?? "").toLowerCase().includes(q),
    );
  }, [query, skills]);

  const scopeLabel = (skill: SkillRecord) => {
    const scope = skillScope(skill);
    if (scope === "global") return t("skillScopeGlobal", "global");
    if (scope === "project") return t("skillScopeProject", "project");
    return t("skillScopePath", "path");
  };

  const statusLine = (() => {
    if (error) return { key: "error", text: t("skillPickerLoadFailed", "Failed to load skills. Try again.") };
    if (loading) return { key: "loading", text: t("skillPickerLoading", "Loading skills…") };
    if (skills.length === 0)
      return { key: "empty", text: t("skillPickerEmpty", "No skills installed yet. Add them from Plugins & Skills.") };
    if (filtered.length === 0) return { key: "nomatch", text: t("skillPickerNoMatch", "No skills match this search") };
    return null;
  })();

  const needle = query.trim().toLowerCase();
  const highlight = (name: string, active: boolean) => {
    const at = needle ? name.toLowerCase().indexOf(needle) : -1;
    if (at < 0) return name;
    return (
      <>
        <span style={{ color: active ? undefined : "var(--fx-text-secondary)" }}>{name.slice(0, at)}</span>
        <span className="type-mono-label-strong">{name.slice(at, at + needle.length)}</span>
        <span style={{ color: active ? undefined : "var(--fx-text-secondary)" }}>{name.slice(at + needle.length)}</span>
      </>
    );
  };

  const groupSizes = filtered.map((skill, index) => {
    if (needle || (index > 0 && skillScope(filtered[index - 1]) === skillScope(skill))) return 0;
    let size = 1;
    while (filtered[index + size] && skillScope(filtered[index + size]) === skillScope(skill)) size += 1;
    return size;
  });

  return (
    <div
      className="composer-pop-in"
      role="menu"
      aria-label={t("skillPickerTitle", "Use a skill")}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        background: "var(--fx-surface-raised)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-composer)",
        boxShadow: "var(--shadow-popover)",
        transformOrigin: "bottom center",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 14px",
          borderBottom: "1px solid var(--fx-line-default)",
        }}
      >
        <span style={{ display: "flex", flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
          <Icon size={15} strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </Icon>
        </span>
        <input
          ref={inputRef}
          // autoFocus plus a microtask refocus: the panel mounts while the
          // composer editor holds focus, and the initial focus can be lost to
          // the outside-pointerdown closer in edge cases.
          autoFocus
          data-skill-search
          value={query}
          placeholder={t("skillPickerSearch", "Search skills…")}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
              return;
            }
            if (e.key === "ArrowDown" && filtered.length > 0) {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(0, i - 1));
              return;
            }
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const target = filtered[activeIndex] ?? filtered[0];
              if (target) onPick(target);
            }
          }}
          className="type-body-default placeholder:text-[var(--fx-text-tertiary)]"
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            padding: 0,
            border: "none",
            background: "none",
            color: "var(--fx-text-primary)",
            caretColor: "var(--fx-accent-blue)",
            outline: "none",
          }}
        />
        {!loading && !error && (
          <span className="type-mono-meta" style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
            {filtered.length}
          </span>
        )}
      </div>
      {statusLine?.key === "loading" ? (
        <div
          className="motion-safe:animate-pulse"
          style={{ display: "flex", flexDirection: "column", gap: 1, padding: 6, flexShrink: 0 }}
        >
          <span className="sr-only">{statusLine.text}</span>
          {SKELETON_ROWS.map(([name, desc]) => (
            <div
              key={name}
              aria-hidden
              style={{ height: 36, display: "flex", alignItems: "center", gap: 10, padding: "0 10px" }}
            >
              <span
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: "var(--space-1)",
                  background: "var(--fx-surface-subtle)",
                }}
              />
              <span
                style={{
                  width: name,
                  height: 10,
                  borderRadius: "var(--space-1)",
                  background: "var(--fx-surface-subtle)",
                }}
              />
              <span
                style={{
                  width: desc,
                  height: 10,
                  borderRadius: "var(--space-1)",
                  background: "var(--fx-surface-subtle)",
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        statusLine && (
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "28px var(--space-4) var(--space-6)",
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 10,
                border: "1px solid var(--fx-line-default)",
                borderRadius: "var(--radius-control)",
                background: "var(--fx-surface-inset)",
                color: statusLine.key === "error" ? "var(--fx-status-danger-text)" : "var(--fx-text-secondary)",
              }}
            >
              <StatusGlyph kind={statusLine.key} />
            </span>
            <span className="type-body-medium" style={{ color: "var(--fx-text-primary)", textAlign: "center" }}>
              {statusLine.text}
            </span>
          </div>
        )
      )}
      <div
        ref={listRef}
        style={{
          position: "relative",
          flex: "1 1 auto",
          minHeight: 0,
          maxHeight: 224,
          overflowY: "auto",
          overscrollBehavior: "contain",
          display: filtered.length > 0 && !loading && !error ? "flex" : "none",
          flexDirection: "column",
          gap: 1,
          padding: 6,
        }}
      >
        <GlideHighlight
          containerRef={listRef}
          rowSelector='[role="menuitem"]'
          activeIndex={activeIndex}
          visible={filtered.length > 0}
          insetX={6}
        />
        {filtered.map((skill, index) => {
          const active = index === activeIndex;
          return (
            <Fragment key={skill.filePath}>
              {groupSizes[index] > 0 && (
                <div
                  aria-hidden
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "var(--space-2) 10px var(--space-1)",
                    color: "var(--fx-text-tertiary)",
                  }}
                >
                  <span className="type-meta-caps">{scopeLabel(skill)}</span>
                  <span className="type-mono-meta">{groupSizes[index]}</span>
                </div>
              )}
              <button
                type="button"
                role="menuitem"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(skill);
                }}
                onMouseEnter={() => {
                  setActiveIndex(index);
                }}
                style={{
                  position: "relative",
                  zIndex: 1,
                  width: "100%",
                  height: 36,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "0 10px",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  background: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "inherit",
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    color: active ? "var(--fx-accent-blue-text)" : "var(--fx-text-tertiary)",
                  }}
                >
                  <PackageIcon size={15} />
                </span>
                <span
                  className="type-mono-label"
                  style={{
                    flexShrink: 0,
                    color: active ? "var(--fx-accent-blue-text)" : "var(--fx-text-primary)",
                  }}
                >
                  {highlight(skill.name, active)}
                </span>
                <span
                  className="type-label-default"
                  style={{
                    minWidth: 0,
                    flex: 1,
                    color: "var(--fx-text-tertiary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {skill.description}
                </span>
                <span
                  className={needle ? "type-meta-default" : "sr-only"}
                  style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
                >
                  {scopeLabel(skill)}
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

const SKELETON_ROWS = [
  [96, 260],
  [120, 220],
  [72, 300],
  [108, 180],
] as const;

function StatusGlyph({ kind }: { kind: string }) {
  if (kind === "error") {
    return (
      <Icon size={16} strokeWidth={1.75}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </Icon>
    );
  }
  if (kind === "nomatch") {
    return (
      <Icon size={16} strokeWidth={1.75}>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3M13.5 8.5l-5 5M8.5 8.5l5 5" />
      </Icon>
    );
  }
  return (
    <Icon size={16} strokeWidth={1.75}>
      <path d="M12 22v-9" />
      <path d="M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.66 1.66 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z" />
      <path d="M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13" />
      <path d="M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.64 1.64 0 0 0 1.63 0z" />
    </Icon>
  );
}

/**
 * Reveal card shown when a skill chip in the composer is clicked: name,
 * description, and the skill's file location. Dismissed with Esc or an
 * outside pointerdown (wired by ChatInput).
 */
export function SkillRevealCard({
  name,
  description,
  filePath,
  onClose,
}: {
  name: string;
  description: string | null;
  filePath: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="composer-pop-in"
      role="dialog"
      aria-label={t("skillRevealTitle", "Skill details")}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        background: "var(--fx-surface-raised)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-composer)",
        boxShadow: "var(--shadow-popover)",
        padding: "var(--space-3) 14px",
        transformOrigin: "bottom center",
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "var(--fx-accent-blue-text)", display: "flex" }}>
          <PackageIcon size={15} />
        </span>
        <span className="type-mono-label-strong" style={{ color: "var(--fx-accent-blue-text)" }}>
          {name}
        </span>
      </div>
      {description && (
        <div className="type-label-default" style={{ marginTop: 6, color: "var(--fx-text-tertiary)" }}>
          {description}
        </div>
      )}
      {filePath && (
        <div
          className="type-mono-meta"
          style={{
            marginTop: "var(--space-2)",
            color: "var(--fx-text-secondary)",
            wordBreak: "break-all",
          }}
        >
          {filePath}
        </div>
      )}
    </div>
  );
}

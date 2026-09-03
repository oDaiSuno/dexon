import { useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { SkillRecord } from "@/lib/api-types";
import { scaledChatFont } from "@/lib/chat-appearance";
import { GlideHighlight } from "./GlideHighlight";
import { PackageIcon } from "./icons";

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
  const [engaged, setEngaged] = useState(false);
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
      return { key: "empty", text: t("skillPickerEmpty", "No skills installed yet. Install them in Settings.") };
    if (filtered.length === 0) return { key: "nomatch", text: t("skillPickerNoMatch", "No skills match this search") };
    return null;
  })();

  return (
    <div
      className="composer-pop-in"
      role="menu"
      aria-label={t("skillPickerTitle", "Use a skill")}
      onMouseLeave={() => setEngaged(false)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow:
          "0 -10px 32px color-mix(in srgb, #000 18%, transparent), 0 2px 10px color-mix(in srgb, #000 10%, transparent)",
        padding: 4,
        transformOrigin: "bottom center",
        maxHeight: 300,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
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
            setEngaged(true);
            setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setEngaged(true);
            setActiveIndex((i) => Math.max(0, i - 1));
            return;
          }
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const target = filtered[activeIndex] ?? filtered[0];
            if (target) onPick(target);
          }
        }}
        style={{
          width: "100%",
          height: 32,
          flexShrink: 0,
          margin: "0 0 4px",
          padding: "0 10px",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text)",
          outline: "none",
          font: "inherit",
          fontSize: scaledChatFont(12.5),
        }}
      />
      {statusLine && (
        <div
          style={{
            height: 36,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            padding: "0 8px",
            fontSize: scaledChatFont(12),
            color: "var(--text-muted)",
          }}
        >
          {statusLine.text}
        </div>
      )}
      <div
        ref={listRef}
        style={{
          position: "relative",
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
        }}
      >
        <GlideHighlight
          containerRef={listRef}
          rowSelector='[role="menuitem"]'
          activeIndex={activeIndex}
          visible={engaged && filtered.length > 0}
          insetX={0}
        />
        {filtered.map((skill, index) => (
          <button
            key={skill.filePath}
            type="button"
            role="menuitem"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(skill);
            }}
            onMouseEnter={() => {
              setActiveIndex(index);
              setEngaged(true);
            }}
            style={{
              position: "relative",
              zIndex: 1,
              width: "100%",
              height: 36,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 8px",
              border: "none",
              borderRadius: 6,
              background: "none",
              cursor: "pointer",
              textAlign: "left",
              font: "inherit",
              color: "inherit",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 22,
                height: 22,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent)",
              }}
            >
              <PackageIcon size={15} />
            </span>
            <span
              style={{
                flexShrink: 0,
                fontSize: scaledChatFont(12.5),
                fontWeight: 500,
                color: "var(--accent)",
              }}
            >
              {skill.name}
            </span>
            <span
              style={{
                minWidth: 0,
                flex: 1,
                fontSize: scaledChatFont(12),
                color: "var(--text-dim)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {skill.description}
            </span>
            <span
              style={{
                flexShrink: 0,
                fontSize: scaledChatFont(10.5),
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              {scopeLabel(skill)}
            </span>
          </button>
        ))}
      </div>
    </div>
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
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow:
          "0 -10px 32px color-mix(in srgb, #000 18%, transparent), 0 2px 10px color-mix(in srgb, #000 10%, transparent)",
        padding: "10px 12px",
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
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--accent)", display: "flex" }}>
          <PackageIcon size={15} />
        </span>
        <span style={{ fontSize: scaledChatFont(13), fontWeight: 600, color: "var(--accent)" }}>{name}</span>
      </div>
      {description && (
        <div style={{ marginTop: 6, fontSize: scaledChatFont(12), lineHeight: 1.55, color: "var(--text-dim)" }}>
          {description}
        </div>
      )}
      {filePath && (
        <div
          style={{
            marginTop: 8,
            fontSize: scaledChatFont(11),
            fontFamily: "var(--font-mono, monospace)",
            color: "var(--text-muted)",
            wordBreak: "break-all",
          }}
        >
          {filePath}
        </div>
      )}
    </div>
  );
}

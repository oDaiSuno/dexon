import { Fragment, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { SkillRecord } from "@/lib/api-types";
import { Button } from "../form-controls";
import { GlideHighlight } from "./GlideHighlight";
import { CircleAlertIcon, PackageIcon, PackageOpenIcon, PuzzleIcon, RefreshCwIcon, SearchIcon } from "./icons";
import { MenuBackButton, MenuDivider, MenuFooter, MenuLinkButton, MenuState, SearchXIcon } from "./menu-chrome";
import { KeyHint } from "./SendControls";

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
  onBack,
  onRetry,
  onManage,
}: {
  skills: SkillRecord[];
  loading: boolean;
  error: string | null;
  onPick: (skill: SkillRecord) => void;
  onClose: () => void;
  onBack: () => void;
  onRetry: () => void;
  onManage?: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
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

  const status = error
    ? "error"
    : loading
      ? "loading"
      : skills.length === 0
        ? "empty"
        : filtered.length === 0
          ? "nomatch"
          : null;

  const countLabel = (() => {
    if (status === "error") return "—";
    if (status === "loading") return "…";
    const count = filtered.length;
    if (needle && count > 0 && status === null) {
      return count === 1
        ? t("skillPickerOneMatch", "1 match")
        : t("skillPickerMatchCount", "{count} matches").replace("{count}", String(count));
    }
    return count === 1
      ? t("skillPickerOneCount", "1 skill")
      : t("skillPickerCount", "{count} skills").replace("{count}", String(count));
  })();

  const retry = () => {
    onRetry();
    inputRef.current?.focus();
  };
  const openResourcesButton = onManage ? (
    <Button onClick={onManage}>
      <PuzzleIcon size={14} />
      {t("skillPickerOpenResources", "Open Plugins & Skills")}
    </Button>
  ) : undefined;

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
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 14px 0 8px",
          borderBottom: "1px solid var(--fx-line-default)",
        }}
      >
        <MenuBackButton label={t("menuBack", "Back")} onClick={onBack} />
        <MenuDivider />
        <span style={{ display: "flex", flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
          <SearchIcon size={15} strokeWidth={2} />
        </span>
        <input
          ref={inputRef}
          autoFocus
          data-skill-search
          value={query}
          placeholder={t("skillPickerSearch", "Search skills…")}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
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
        <span className="type-mono-meta" style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
          {countLabel}
        </span>
      </div>
      {status === "loading" ? (
        <div
          className="motion-safe:animate-pulse"
          style={{ display: "flex", flexDirection: "column", gap: 1, padding: 6, flexShrink: 0 }}
        >
          <span className="sr-only">{t("skillPickerLoading", "Loading skills…")}</span>
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
                  borderRadius: "var(--radius-xs)",
                  background: "var(--fx-surface-subtle)",
                }}
              />
              <span
                style={{
                  width: name,
                  height: 10,
                  borderRadius: "var(--radius-skeleton)",
                  background: "var(--fx-surface-subtle)",
                }}
              />
              <span
                style={{
                  width: desc,
                  height: 10,
                  borderRadius: "var(--radius-skeleton)",
                  background: "var(--fx-surface-subtle)",
                }}
              />
            </div>
          ))}
        </div>
      ) : status === "error" ? (
        <MenuState
          tone="danger"
          icon={<CircleAlertIcon size={16} />}
          title={t("skillPickerLoadFailed", "Failed to load skills")}
          description={t(
            "skillPickerLoadFailedHint",
            "Something went wrong while reading installed skills. Skills you already have are not affected.",
          )}
          action={
            <Button onClick={retry}>
              <RefreshCwIcon size={14} />
              {t("retry", "Retry")}
            </Button>
          }
        />
      ) : status === "empty" ? (
        <MenuState
          icon={<PackageOpenIcon size={16} />}
          title={t("skillPickerEmpty", "No skills installed yet")}
          description={t(
            "skillPickerEmptyHint",
            "Skills give the agent a set way to work, such as research, releases or reviews.",
          )}
          action={openResourcesButton}
        />
      ) : status === "nomatch" ? (
        <MenuState
          icon={<SearchXIcon size={16} />}
          title={t("skillPickerNoMatch", "No skills match “{query}”").replace("{query}", query.trim())}
          description={t("skillPickerNoMatchHint", "Try another keyword, or install new skills from Plugins & Skills.")}
          action={openResourcesButton}
        />
      ) : (
        <div
          style={{
            position: "relative",
            flex: "1 1 auto",
            minHeight: 0,
            maxHeight: 224,
            overflowY: "auto",
            overscrollBehavior: "contain",
            display: "flex",
            flexDirection: "column",
            gap: 1,
            padding: 6,
          }}
        >
          <GlideHighlight
            rowSelector='[role="menuitem"]'
            activeIndex={activeIndex}
            visible={filtered.length > 0}
            layoutKey={filtered}
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
                  {active && <KeyHint keyLabel="↵" label={t("skillPickerInsert", "Insert")} />}
                </button>
              </Fragment>
            );
          })}
        </div>
      )}
      <MenuFooter
        hints={[
          { keyLabel: "↑↓", label: t("menuKeySelect", "Select") },
          { keyLabel: "↵", label: t("skillPickerInsertAtStart", "Insert at start") },
          { keyLabel: "esc", label: t("menuKeyClose", "Close") },
        ]}
        trailing={onManage && <MenuLinkButton label={t("skillPickerManage", "Manage skills")} onClick={onManage} />}
      />
    </div>
  );
}

const SKELETON_ROWS = [
  [96, 260],
  [120, 220],
  [72, 300],
  [108, 180],
] as const;

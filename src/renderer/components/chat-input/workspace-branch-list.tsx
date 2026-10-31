import { useI18n } from "@/i18n";
import { ArrowRightIcon, PlusIcon, SearchIcon } from "./icons";
import { CLEAR, QUICK, paint } from "./menu-chrome";
import type { ComposerWorkspaceCard } from "./types";
import { BranchRow } from "./workspace-branch-row";
import { ELLIPSIS, GLYPH, HOVER_OVERLAY, OUTLINE_NONE, SURFACE_INSET } from "./workspace-chrome";
import { FolderGlyph } from "./workspace-glyphs";

const SECTION_ROW = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexShrink: 0,
  padding: "10px 8px 4px 8px",
  color: "var(--fx-text-tertiary)",
} as const;

const ROW_BASE = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  height: 32,
  flexShrink: 0,
  boxSizing: "border-box",
  padding: "0 8px",
  border: "none",
  borderRadius: "var(--radius-control)",
  cursor: "pointer",
  textAlign: "left",
  transition: `background ${QUICK}`,
} as const;

export function WorkspaceBranchList({
  card,
  activeKey,
  onActivateRow,
  onFocusRow,
  onSwitchToProject,
}: {
  card: ComposerWorkspaceCard;
  activeKey: string;
  onActivateRow: (key: string) => void;
  onFocusRow: (key: string) => void;
  onSwitchToProject: () => void;
}) {
  const { t } = useI18n();
  const pane = card.pane;
  const sections =
    pane.state === "ready"
      ? [
          { label: t("sectionCurrent", "Current"), note: null, rows: pane.sections.current },
          { label: t("sectionInFolders", "In their own folders"), note: null, rows: pane.sections.folders },
          {
            label: t("sectionOtherLocal", "Other local branches"),
            note: t("sortByRecentCommit", "By recent commit"),
            rows: pane.sections.others,
          },
          { label: null, note: null, rows: pane.sections.stale },
        ]
      : [];

  return (
    <div
      role="group"
      aria-label={t("branchesOf", "{project} branches").replace("{project}", card.browsedName)}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minHeight: 0,
        boxSizing: "border-box",
        padding: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px", height: 32, flexShrink: 0 }}>
        <span className="type-body-medium" style={{ ...ELLIPSIS, color: "var(--fx-text-primary)" }}>
          {card.browsedName}
        </span>
        <span className="type-body-default" style={{ flexShrink: 0, color: "var(--fx-text-secondary)" }}>
          {t("branchesSuffix", "branches")}
        </span>
        <span
          className="type-mono-meta"
          style={{ marginLeft: "auto", flexShrink: 0, color: "var(--fx-text-tertiary)" }}
        >
          {pane.state === "ready" ? t("branchCount", "{count}").replace("{count}", String(pane.count)) : "—"}
        </span>
      </div>

      {pane.state === "ready" && card.showFilter && (
        <div style={{ padding: "0 2px 4px 2px", flexShrink: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 30,
              boxSizing: "border-box",
              padding: "0 10px",
              border: "1px solid var(--fx-line-default)",
              borderRadius: "var(--radius-row)",
              background: SURFACE_INSET,
            }}
          >
            <span style={{ ...GLYPH, color: "var(--fx-text-tertiary)" }}>
              <SearchIcon size={13} strokeWidth={2} />
            </span>
            <input
              type="text"
              value={card.filter}
              onChange={(event) => card.setFilter(event.target.value)}
              placeholder={t("branchFilter", "Filter branches…")}
              aria-label={t("branchFilter", "Filter branches…")}
              data-workspace-filter="true"
              className="type-body-default"
              style={{
                ...OUTLINE_NONE,
                flex: 1,
                minWidth: 0,
                height: "100%",
                border: "none",
                background: "transparent",
                color: "var(--fx-text-primary)",
              }}
            />
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", minHeight: 0 }}>
        {pane.state === "not-repo" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              padding: "36px 24px 0 24px",
              textAlign: "center",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                boxSizing: "border-box",
                border: "1px solid var(--fx-line-default)",
                borderRadius: "var(--radius-control)",
                background: SURFACE_INSET,
                color: "var(--fx-text-secondary)",
              }}
            >
              <FolderGlyph size={16} />
            </span>
            <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
              {t("notGitTitle", "{project} is not a git repository").replace("{project}", card.browsedName)}
            </span>
            <span className="type-meta-default" style={{ color: "var(--fx-text-secondary)" }}>
              {t(
                "notGitBody",
                "There are no branches here. Press Enter or click the row on the left to switch to this folder.",
              )}
            </span>
            <div style={{ paddingTop: 8 }}>
              <button
                type="button"
                onClick={onSwitchToProject}
                data-workspace-action="switch-project"
                className="type-label-medium"
                style={{
                  ...OUTLINE_NONE,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 28,
                  padding: "0 10px",
                  border: "1px solid var(--fx-line-default)",
                  borderRadius: "var(--radius-control)",
                  background: "var(--fx-surface-raised)",
                  color: "var(--fx-text-primary)",
                  cursor: "pointer",
                }}
              >
                <ArrowRightIcon size={13} strokeWidth={1.75} />
                {t("switchTo", "Switch to {project}").replace("{project}", card.browsedName)}
              </button>
            </div>
          </div>
        )}

        {sections.map((section, index) =>
          section.rows.length === 0 ? null : (
            <div key={`${section.label ?? "stale"}-${index}`} style={{ display: "contents" }}>
              {section.label && (
                <div className="type-meta-caps" style={SECTION_ROW}>
                  <span style={{ ...ELLIPSIS }}>{section.label}</span>
                  {section.note && (
                    <span className="type-meta-default" style={{ marginLeft: "auto", flexShrink: 0 }}>
                      {section.note}
                    </span>
                  )}
                </div>
              )}
              {section.rows.map((row) => (
                <BranchRow
                  key={row.key}
                  row={row}
                  card={card}
                  active={activeKey === row.key}
                  onActivate={onActivateRow}
                  onFocusRow={onFocusRow}
                />
              ))}
            </div>
          ),
        )}

        {pane.state === "ready" && (
          <>
            <div style={{ height: 1, flexShrink: 0, margin: "5px 2px", background: "var(--fx-surface-selected)" }} />
            {card.newEntryOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "2px 2px 6px" }}>
                <input
                  autoFocus
                  value={card.newBranch}
                  onChange={(event) => card.setNewBranch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.stopPropagation();
                      card.createCheckout();
                    }
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      card.closeNewEntry();
                    }
                  }}
                  placeholder={t("branchName", "branch name")}
                  aria-label={t("branchName", "branch name")}
                  className="type-mono-label"
                  style={{
                    ...OUTLINE_NONE,
                    width: "100%",
                    height: 30,
                    boxSizing: "border-box",
                    padding: "0 8px",
                    border: "1px solid var(--fx-accent-blue)",
                    borderRadius: "var(--radius-control)",
                    background: "var(--fx-surface-main)",
                    color: "var(--fx-text-primary)",
                  }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={card.createCheckout}
                    disabled={card.busy || !card.newBranch.trim()}
                    className="type-label-medium"
                    style={{
                      ...OUTLINE_NONE,
                      flex: 1,
                      height: 28,
                      background: "var(--fx-accent-blue-fill)",
                      border: "none",
                      borderRadius: "var(--radius-control)",
                      color: "var(--fx-text-on-accent)",
                      cursor: card.busy || !card.newBranch.trim() ? "not-allowed" : "pointer",
                      opacity: card.busy || !card.newBranch.trim() ? 0.65 : 1,
                    }}
                  >
                    {card.busy ? t("creating", "Creating…") : t("create", "Create")}
                  </button>
                  <button
                    type="button"
                    onClick={card.closeNewEntry}
                    className="type-label-default"
                    style={{
                      ...OUTLINE_NONE,
                      flex: 1,
                      height: 28,
                      background: HOVER_OVERLAY,
                      border: "1px solid var(--fx-line-default)",
                      borderRadius: "var(--radius-control)",
                      color: "var(--fx-text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    {t("cancel", "Cancel")}
                  </button>
                </div>
                {card.error && (
                  <div
                    role="alert"
                    className="type-meta-default"
                    style={{ color: "var(--fx-status-danger-text)", overflowWrap: "anywhere" }}
                  >
                    {card.error}
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={card.openNewEntry}
                title={t("createWorktreeHint", "Create a worktree checkout for a branch")}
                data-workspace-action="new-worktree"
                style={{ ...OUTLINE_NONE, ...ROW_BASE, background: CLEAR, color: "var(--fx-text-body)" }}
                onMouseEnter={(event) => paint(event, HOVER_OVERLAY)}
                onMouseLeave={(event) => paint(event, CLEAR)}
              >
                <span style={{ ...GLYPH, color: "var(--fx-text-secondary)" }}>
                  <PlusIcon size={15} />
                </span>
                <span className="type-body-default" style={{ ...ELLIPSIS, flex: 1 }}>
                  {t("newWorktree", "New worktree…")}
                </span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

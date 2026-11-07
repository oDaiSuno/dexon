import type { FolderEntry } from "@contract/folder-browse";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import type { BrowsableFolderListing, FolderBrowserState } from "./folder-browser-state";
import { FolderPickerIcon, GitBranchBadge } from "./folder-picker-ui";

export interface FolderColumnsProps {
  state: FolderBrowserState;
  disabled?: boolean;
  onSelectChild: (entry: FolderEntry) => void;
  onOpenPath: (path: string) => void;
}

function DirectoryList({
  listing,
  selected,
  selectionMark = true,
  disabled,
  onSelectChild,
  onOpenPath,
}: {
  listing: BrowsableFolderListing;
  selected: FolderEntry | null;
  selectionMark?: boolean;
} & Pick<FolderColumnsProps, "disabled" | "onSelectChild" | "onOpenPath">) {
  const { t } = useI18n();
  return (
    <>
      <ul
        aria-label={listing.displayPath}
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-0-5)" }}
      >
        {listing.folders.map((entry) => {
          const chosen = selected?.displayPath === entry.displayPath;
          return (
            <li
              key={entry.displayPath}
              style={{
                display: "flex",
                alignItems: "center",
                borderRadius: "var(--radius-row)",
                background: chosen
                  ? selectionMark
                    ? "var(--fx-accent-blue-soft)"
                    : "var(--fx-surface-selected)"
                  : "var(--fx-surface-hover-clear)",
              }}
            >
              <Button
                variant="ghost"
                className="remote-folder-choice"
                disabled={disabled}
                aria-label={`${t("remoteFolderSelect", "Select folder")} ${entry.name}`}
                aria-pressed={chosen}
                title={entry.displayPath}
                onClick={() => onSelectChild(entry)}
                onDoubleClick={() => onOpenPath(entry.displayPath)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  justifyContent: "flex-start",
                  padding: "var(--space-1) var(--space-2)",
                  color: "var(--fx-text-primary)",
                }}
              >
                <FolderPickerIcon kind="folder" size={15} />
                <span
                  className="type-body-default remote-folder-name"
                  style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}
                >
                  {entry.name}
                </span>
                <GitBranchBadge git={entry.git} />
                {chosen && selectionMark && (
                  <span
                    className="type-label-medium remote-folder-selected"
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      color: "var(--fx-accent-blue-text)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t("remoteFolderSelected", "✓ Selected")}
                  </span>
                )}
              </Button>
              <Button
                variant="ghost"
                disabled={disabled}
                aria-label={`${t("remoteFolderEnter", "Open folder")} ${entry.name}`}
                onClick={() => onOpenPath(entry.displayPath)}
                style={{ padding: "0 var(--space-1)", flexShrink: 0 }}
              >
                <span aria-hidden="true">›</span>
              </Button>
            </li>
          );
        })}
      </ul>
      {listing.truncated && (
        <p className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {t("remoteFolderTruncated", "Some folders are not shown. Enter a path to open them directly.")}
        </p>
      )}
    </>
  );
}

function EmptyFolder() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      style={{
        display: "grid",
        justifyItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-8) var(--space-3)",
        textAlign: "center",
      }}
    >
      <FolderPickerIcon kind="folder" size={24} />
      <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
        {t("remoteFolderEmpty", "This folder has no subfolders")}
      </span>
      <span className="type-label-default">
        {t("remoteFolderEmptyHint", "You can mount the current folder without opening a subfolder.")}
      </span>
    </div>
  );
}

function LoadingFolders() {
  const { t } = useI18n();
  return (
    <div role="status" aria-live="polite" style={{ display: "grid", gap: "var(--space-3)", padding: "var(--space-3)" }}>
      <span className="type-label-medium" style={{ color: "var(--fx-accent-blue-text)" }}>
        {t("remoteFolderLoading", "Reading remote folders…")}
      </span>
      {["70%", "54%", "85%", "62%"].map((width) => (
        <div
          key={width}
          aria-hidden="true"
          style={{
            height: "var(--space-8)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            background: "var(--fx-surface-card)",
            borderRadius: "var(--radius-row)",
            padding: "0 var(--space-2)",
          }}
        >
          <span
            style={{
              height: "var(--space-3-5)",
              width: "var(--space-3-5)",
              background: "var(--fx-surface-track)",
              borderRadius: "var(--radius-xs)",
            }}
          />
          <span
            style={{
              height: "var(--space-2-5)",
              width,
              background: "var(--fx-surface-track)",
              borderRadius: "var(--radius-xs)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function FolderColumns({ state, disabled, onSelectChild, onOpenPath }: FolderColumnsProps) {
  const { t } = useI18n();
  const base = "base" in state ? state.base : null;
  const selected = "selectedChild" in state ? state.selectedChild : null;
  const current = "preview" in state ? state.preview : null;
  const selectedPreviewChild = "selectedPreviewChild" in state ? state.selectedPreviewChild : null;
  const callbacks = { disabled, onSelectChild, onOpenPath };
  return (
    <div
      aria-label={t("remoteFolderColumns", "Remote folder browser")}
      className="remote-folder-columns"
      aria-busy={state.kind === "loading"}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 0.8fr) minmax(0, 1.2fr)",
        flex: 1,
        minHeight: 240,
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        color: "var(--fx-text-secondary)",
      }}
    >
      <section
        style={{
          background: "var(--fx-surface-card)",
          padding: "var(--space-2) var(--space-1-5)",
          borderRight: "1px solid var(--fx-line-default)",
          overflow: "auto",
        }}
      >
        {base ? (
          <>
            <h3
              className="type-mono-meta"
              style={{ margin: "0 0 var(--space-2)", padding: "0 var(--space-2)", overflowWrap: "anywhere" }}
            >
              {base.displayPath}
            </h3>
            <DirectoryList listing={base} selected={selected} selectionMark={!selectedPreviewChild} {...callbacks} />
            {!base.folders.length && <EmptyFolder />}
          </>
        ) : state.kind === "loading" ? (
          <LoadingFolders />
        ) : null}
      </section>
      <section style={{ padding: "var(--space-2)", overflow: "auto" }}>
        {current ? (
          <>
            <h3
              className="type-mono-meta"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-2)",
                margin: "0 0 var(--space-2)",
                overflowWrap: "anywhere",
              }}
            >
              <span>{current.displayPath}</span>
              <GitBranchBadge git={current.git} />
              {!selectedPreviewChild && state.kind === "ready" && (
                <span className="type-label-medium" style={{ color: "var(--fx-accent-blue-text)" }}>
                  {t("remoteFolderSelected", "✓ Selected")}
                </span>
              )}
            </h3>
            {current.folders.length ? (
              <DirectoryList listing={current} selected={selectedPreviewChild} {...callbacks} />
            ) : (
              <EmptyFolder />
            )}
          </>
        ) : state.kind === "loading" ? (
          <LoadingFolders />
        ) : state.kind === "ready" ? (
          <div role="status" className="type-label-default" style={{ padding: "var(--space-5)", textAlign: "center" }}>
            {t("remoteFolderChooseChild", "Select a folder to view its subfolders, or mount the current folder.")}
          </div>
        ) : null}
      </section>
    </div>
  );
}

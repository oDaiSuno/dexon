import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import type { FileSuggestionDegradedReason } from "@/lib/file-suggestion-client";
import { FolderIcon, getFileIcon } from "../FileIcons";
import { CircleAlertIcon } from "./icons";
import { FileSearchIcon, MenuFooter, MenuHeader, MenuPanel, MenuState } from "./menu-chrome";
import { KeyHint } from "./SendControls";

export interface AtSuggestionState {
  cwd: string;
  tokenKey: string;
  query: string;
  matches: FileIndexEntry[];
  truncated: boolean;
  degradedReason?: FileSuggestionDegradedReason;
  status: "loading" | "ready" | "error";
}

const SKELETON_BARS: [number, number][] = [
  [220, 110],
  [180, 90],
  [260, 70],
  [200, 120],
];

const LIST_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: 1,
  padding: 6,
} as const;

/** @ file autocomplete list above the composer. Presentation only. */
export function AtMenu({
  suggestionState,
  matches,
  activeIndex,
  itemRefs,
  onApply,
  onHover,
}: {
  suggestionState: AtSuggestionState | null;
  matches: FileIndexEntry[];
  activeIndex: number;
  itemRefs: { current: (HTMLButtonElement | null)[] };
  onApply: (entry: FileIndexEntry) => void;
  onHover: (index: number) => void;
}) {
  const { t } = useI18n();
  const loading = !suggestionState || suggestionState.status === "loading";
  const failed = suggestionState?.status === "error";
  const query = suggestionState?.query ?? "";
  const countLabel = loading
    ? "…"
    : failed
      ? "—"
      : matches.length === 0
        ? t("noMatchCount", "0 matches")
        : matches.length === 1
          ? t("oneMatch", "1 match")
          : t("matchCount", "{count} matches").replace("{count}", String(matches.length));
  const showNotes = !loading && !failed;
  const notes: ReactNode[] = [];
  if (showNotes && suggestionState?.degradedReason) {
    notes.push(
      <HeaderNote
        key="scope"
        icon={<FolderIcon size={12} />}
        label={t("fileSearchDegraded", "limited to this folder")}
      />,
    );
  }
  if (showNotes && suggestionState?.truncated) {
    notes.push(<HeaderNote key="truncated" label={t("fileIndexTruncated", "index truncated")} />);
  }
  const needle = query.slice(query.lastIndexOf("/") + 1).toLowerCase();
  const mentionLabel = t("menuKeyMention", "Mention");

  let body: ReactNode;
  if (loading) {
    body = <FileSkeleton />;
  } else if (failed) {
    body = (
      <MenuState
        tone="danger"
        icon={<CircleAlertIcon size={16} />}
        title={t("fileSuggestionsUnavailable", "File suggestions are temporarily unavailable")}
        description={t(
          "fileSuggestionsUnavailableHint",
          "Something went wrong reading project files. You can still type a full path by hand; sending is not affected.",
        )}
      />
    );
  } else if (matches.length === 0) {
    body = (
      <MenuState
        icon={<FileSearchIcon />}
        title={
          query
            ? t("noMatchingProjectFiles", "No files match “{query}”").replace("{query}", query)
            : t("noFilesFound", "No files found")
        }
        description={t("fileNoMatchHint", "Try a shorter keyword, or separate folders with /, for example set/row.")}
      />
    );
  } else {
    body = (
      <div style={{ ...LIST_STYLE, maxHeight: 224, overflowY: "auto", overscrollBehavior: "contain" }}>
        {matches.map((entry, index) => (
          <FileRow
            key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
            entry={entry}
            needle={needle}
            active={index === activeIndex}
            mentionLabel={mentionLabel}
            buttonRef={(node) => {
              itemRefs.current[index] = node;
            }}
            onApply={() => onApply(entry)}
            onHover={() => onHover(index)}
          />
        ))}
      </div>
    );
  }

  const panelLabel = t("filesAndMatchCount", "Files · {count}").replace("{count}", countLabel);
  const announcement = loading
    ? t("loadingProjectFiles", "Loading files…")
    : failed
      ? t("fileSuggestionsUnavailable", "File suggestions are temporarily unavailable")
      : panelLabel;
  return (
    <MenuPanel label={panelLabel}>
      <MenuHeader
        announcement={announcement}
        sigil="@"
        title={t("atMenuTitle", "Files")}
        query={query}
        note={notes.length > 0 ? notes : undefined}
        count={countLabel}
      />
      {body}
      <MenuFooter
        hints={[
          { keyLabel: "↑↓", label: t("menuKeySelect", "Select") },
          { keyLabel: "tab / ↵", label: mentionLabel },
          { keyLabel: "esc", label: t("menuKeyClose", "Close") },
        ]}
        note={t("atFolderHint", "Paths ending in / are folders")}
      />
    </MenuPanel>
  );
}

function HeaderNote({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <>
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, color: "var(--fx-text-tertiary)" }}>
        {icon}
        <span className="type-meta-default">{label}</span>
      </span>
      <span aria-hidden style={{ width: 1, height: 12, flexShrink: 0, background: "var(--fx-line-default)" }} />
    </>
  );
}

function FileRow({
  entry,
  needle,
  active,
  mentionLabel,
  buttonRef,
  onApply,
  onHover,
}: {
  entry: FileIndexEntry;
  needle: string;
  active: boolean;
  mentionLabel: string;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onApply: () => void;
  onHover: () => void;
}) {
  const name = entry.path.split("/").pop() ?? entry.path;
  const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
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
        height: 34,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 10px",
        border: "none",
        borderRadius: "var(--radius-control)",
        background: active ? "var(--fx-surface-hover-overlay)" : "var(--fx-surface-hover-clear)",
        transition: "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
        color: "var(--fx-text-primary)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
      </span>
      <span
        className="type-mono-label"
        style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {dirPrefix && <span style={{ color: "var(--fx-text-tertiary)" }}>{dirPrefix}</span>}
        <HighlightedName name={name} needle={needle} />
        {entry.isDir && <span style={{ color: "var(--fx-text-tertiary)" }}>/</span>}
      </span>
      {active && <KeyHint keyLabel="↵" label={mentionLabel} />}
    </button>
  );
}

function HighlightedName({ name, needle }: { name: string; needle: string }) {
  const at = needle ? name.toLowerCase().indexOf(needle) : -1;
  const muted = { color: "var(--fx-text-secondary)" };
  if (at < 0) return <span style={muted}>{name}</span>;
  return (
    <>
      <span style={muted}>{name.slice(0, at)}</span>
      <span className="type-mono-label-strong" style={{ color: "var(--fx-text-primary)" }}>
        {name.slice(at, at + needle.length)}
      </span>
      <span style={muted}>{name.slice(at + needle.length)}</span>
    </>
  );
}

function FileSkeleton() {
  return (
    <div aria-hidden className="motion-safe:animate-pulse" style={LIST_STYLE}>
      {SKELETON_BARS.map(([path, name], index) => (
        <div key={index} style={{ height: 34, display: "flex", alignItems: "center", gap: 10, padding: "0 10px" }}>
          <span style={{ ...BAR_STYLE, width: 14, height: 14, borderRadius: "var(--radius-xs)" }} />
          <span style={{ ...BAR_STYLE, width: path, maxWidth: "50%", height: 10 }} />
          <span style={{ ...BAR_STYLE, width: name, height: 10 }} />
        </div>
      ))}
    </div>
  );
}

const BAR_STYLE = {
  display: "block",
  flexShrink: 0,
  borderRadius: "var(--radius-skeleton)",
  background: "var(--fx-surface-subtle)",
} as const;

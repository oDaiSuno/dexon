import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import type { FileSuggestionDegradedReason } from "@/lib/file-suggestion-client";
import { FolderIcon, getFileIcon } from "../FileIcons";

export interface AtSuggestionState {
  cwd: string;
  tokenKey: string;
  query: string;
  matches: FileIndexEntry[];
  truncated: boolean;
  degradedReason?: FileSuggestionDegradedReason;
  status: "loading" | "ready" | "error";
}

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
  const matchCountLabel =
    matches.length === 1
      ? t("oneMatch", "1 match")
      : t("matchCount", "{count} matches").replace("{count}", String(matches.length));
  const resultHint = suggestionState?.degradedReason
    ? ` · ${t("fileSearchDegraded", "limited to this folder")}`
    : suggestionState?.truncated
      ? ` · ${t("fileIndexTruncated", "index truncated")}`
      : "";
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
        overflow: "hidden",
        maxHeight: "min(48vh, 400px)",
      }}
    >
      <div
        aria-live="polite"
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: scaledChatFont(11),
          color: "var(--text-dim)",
        }}
      >
        <span>
          {loading
            ? t("loadingProjectFiles", "Loading files…")
            : `${t("filesAndMatchCount", "Files · {count}").replace("{count}", matchCountLabel)}${resultHint}`}
        </span>
        <span style={{ fontFamily: "var(--font-mono)" }}>Tab / Enter</span>
      </div>
      <div style={{ maxHeight: "calc(min(48vh, 400px) - 34px)", overflowY: "auto", padding: 4 }}>
        {matches.length === 0 ? (
          <div style={{ padding: "8px 8px", fontSize: scaledChatFont(12), color: "var(--text-dim)" }}>
            {loading
              ? t("searching", "Searching…")
              : suggestionState?.status === "error"
                ? t("fileSuggestionsUnavailable", "File suggestions are temporarily unavailable")
                : t("noMatchingProjectFiles", "No matching files")}
          </div>
        ) : (
          matches.map((entry, index) => {
            const active = index === activeIndex;
            const name = entry.path.split("/").pop() ?? entry.path;
            const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
            return (
              <button
                key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onApply(entry);
                }}
                onMouseEnter={() => onHover(index)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 8px",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  background: active ? "var(--bg-selected)" : "none",
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: scaledChatFont(12.5),
                  fontFamily: "var(--font-mono)",
                }}
              >
                <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                  {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                </span>
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {dirPrefix && <span style={{ color: "var(--text-dim)" }}>{dirPrefix}</span>}
                  {name}
                  {entry.isDir && <span style={{ color: "var(--text-dim)" }}>/</span>}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

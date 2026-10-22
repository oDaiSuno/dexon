import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { useI18n } from "@/i18n";

function Chevron({ direction }: { direction: "previous" | "next" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === "previous" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  );
}

const arrowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  background: "none",
  border: "none",
  borderRadius: "var(--radius-chip)",
  color: "var(--fx-text-tertiary)",
  cursor: "pointer",
  transition: "color var(--duration-quick) var(--ease-out)",
} as const;

export function UserMessageFooter({
  hovered,
  time,
  running,
  copyableContent,
  versions,
  canEdit,
  onEdit,
  onSwitchVersion,
}: {
  hovered: boolean;
  time: string | null;
  running: boolean;
  copyableContent: string;
  versions?: { entryIds: string[]; index: number };
  canEdit: boolean;
  onEdit: () => void;
  onSwitchVersion: (entryId: string) => void;
}) {
  const { t } = useI18n();
  const { copied, copy } = useCopyFeedback();
  const previousVersion = versions && versions.index > 0 ? versions.entryIds[versions.index - 1] : undefined;
  const nextVersion =
    versions && versions.index < versions.entryIds.length - 1 ? versions.entryIds[versions.index + 1] : undefined;

  const copyTitle = copyableContent ? t("copyMessage", "Copy message") : t("nothingToCopy", "Nothing to copy");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 4,
        marginTop: 4,
      }}
    >
      <div
        className="message-hover-actions"
        style={{
          display: "flex",
          gap: 2,
          opacity: hovered ? 1 : 0,
          pointerEvents: hovered ? "auto" : "none",
          transition: "opacity var(--duration-quick) var(--ease-out)",
        }}
      >
        <button
          type="button"
          onClick={() => void copy(copyableContent)}
          disabled={!copyableContent}
          title={copyTitle}
          aria-label={copyTitle}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            background: "none",
            border: "none",
            borderRadius: "var(--radius-chip)",
            color: copied ? "var(--fx-status-success-text)" : "var(--fx-text-tertiary)",
            cursor: copyableContent ? "pointer" : "not-allowed",
            opacity: copyableContent ? 1 : 0.55,
            transition: "color var(--duration-quick) var(--ease-out)",
          }}
          onMouseEnter={(e) => {
            if (!copied) e.currentTarget.style.color = "var(--fx-text-secondary)";
          }}
          onMouseLeave={(e) => {
            if (!copied) e.currentTarget.style.color = "var(--fx-text-tertiary)";
          }}
        >
          {copied ? (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="12" height="12" rx="2.5" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            title={t("editMessage", "Edit")}
            className="type-meta-default"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              height: 24,
              background: "none",
              border: "none",
              borderRadius: "var(--radius-chip)",
              color: "var(--fx-text-tertiary)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "color var(--duration-quick) var(--ease-out)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--fx-accent-blue-text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--fx-text-tertiary)";
            }}
          >
            {t("editMessage", "Edit")}
          </button>
        )}
      </div>
      {versions && (
        <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
          <button
            type="button"
            aria-label={t("previousVersion", "Previous version")}
            title={t("previousVersion", "Previous version")}
            disabled={running || !previousVersion}
            onClick={() => {
              if (previousVersion) onSwitchVersion(previousVersion);
            }}
            style={{ ...arrowStyle, cursor: running || !previousVersion ? "not-allowed" : "pointer" }}
          >
            <Chevron direction="previous" />
          </button>
          <span
            className="type-mono-meta"
            style={{
              color: "var(--fx-text-tertiary)",
              minWidth: 28,
              textAlign: "center",
            }}
          >
            {`${versions.index + 1} / ${versions.entryIds.length}`}
          </span>
          <button
            type="button"
            aria-label={t("nextVersion", "Next version")}
            title={t("nextVersion", "Next version")}
            disabled={running || !nextVersion}
            onClick={() => {
              if (nextVersion) onSwitchVersion(nextVersion);
            }}
            style={{ ...arrowStyle, cursor: running || !nextVersion ? "not-allowed" : "pointer" }}
          >
            <Chevron direction="next" />
          </button>
        </div>
      )}
      {time && (
        <span
          className="type-mono-meta"
          style={{
            color: "var(--fx-text-tertiary)",
            opacity: hovered ? 1 : 0,
            transition: "opacity var(--duration-quick) var(--ease-out)",
          }}
        >
          {time}
        </span>
      )}
    </div>
  );
}

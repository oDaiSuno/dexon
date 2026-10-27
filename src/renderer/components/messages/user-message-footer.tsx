import { useI18n } from "@/i18n";
import { EditMessageGlyph, MessageActionButton, MessageCopyButton } from "./message-action-button";

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
  const previousVersion = versions && versions.index > 0 ? versions.entryIds[versions.index - 1] : undefined;
  const nextVersion =
    versions && versions.index < versions.entryIds.length - 1 ? versions.entryIds[versions.index + 1] : undefined;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 2,
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
        <MessageCopyButton text={copyableContent} />
        {canEdit && (
          <MessageActionButton label={t("editMessage", "Edit")} onClick={onEdit}>
            <EditMessageGlyph />
          </MessageActionButton>
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

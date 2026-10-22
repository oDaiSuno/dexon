import { useI18n } from "@/i18n";
import { resolveSessionTitle, useSessionCatalog } from "@/lib/session-catalog";
import { requestOpenSession } from "@/lib/session-open-request";
import type { SessionSourceRef, SessionToolTargetDetails } from "@shared/session-orchestration";

function HandoffGlyph({ color }: { color: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0, color }}
    >
      <path d="M4 4v7a4 4 0 0 0 4 4h8" />
      <polyline points="13 12 16 15 13 18" />
    </svg>
  );
}

export function SessionSourceChip({ source }: { source: SessionSourceRef }) {
  const { t } = useI18n();
  const title = resolveSessionTitle(source.sessionId, source.title, useSessionCatalog());
  const label = t("sessionSourceFrom", "From session {title}").replace("{title}", title);
  return (
    <button
      type="button"
      onClick={() => requestOpenSession(source.sessionId)}
      aria-label={label}
      title={label}
      className="session-source-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        maxWidth: "100%",
        marginBottom: 6,
        padding: "1px 7px 1px 6px",
        border: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
        borderRadius: "var(--radius-chip)",
        background: "color-mix(in srgb, currentColor 8%, transparent)",
        color: "inherit",
        cursor: "pointer",
        fontSize: 11,
        lineHeight: 1.6,
        opacity: 0.85,
        transition: "opacity var(--duration-quick) var(--ease-out)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.opacity = "1";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.opacity = "0.85";
      }}
    >
      <HandoffGlyph color="currentColor" />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}

export function SessionTargetLink({ target }: { target: SessionToolTargetDetails }) {
  const { t } = useI18n();
  const title = resolveSessionTitle(target.targetSessionId, target.targetTitle, useSessionCatalog());
  const label = t("sessionTargetOpen", "Open session {title}").replace("{title}", title);
  return (
    <button
      type="button"
      onClick={() => requestOpenSession(target.targetSessionId)}
      aria-label={label}
      title={label}
      className="chat-tool-session-link"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        maxWidth: "100%",
        marginTop: 2,
        padding: "1px 7px 1px 6px",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-chip)",
        background: "transparent",
        color: "var(--fx-text-secondary)",
        cursor: "pointer",
        fontSize: 11,
        lineHeight: 1.7,
        transition: "background var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "var(--fx-surface-hover-overlay-strong)";
        event.currentTarget.style.color = "var(--fx-text-primary)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
        event.currentTarget.style.color = "var(--fx-text-secondary)";
      }}
    >
      <HandoffGlyph color="currentColor" />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
    </button>
  );
}

import { Fragment } from "react";
import { useI18n } from "@/i18n";
import { getSessionDisplayTitle } from "@/lib/session-list";
import { useSessionCatalog } from "@/lib/session-catalog";
import { sessionPath, type SessionPathSegment } from "@/lib/session-path";
import { requestOpenSession } from "@/lib/session-open-request";
import type { SessionInfo } from "@/lib/types";

type PathItem = SessionPathSegment | { gap: true };

export function SessionBreadcrumb({ session }: { session: SessionInfo }) {
  const { t } = useI18n();
  const catalog = useSessionCatalog();
  const { segments, truncated } = sessionPath(session, catalog);
  if (segments.length < 2) return null;
  const items: PathItem[] = truncated ? [segments[0], { gap: true }, ...segments.slice(1)] : segments;

  return (
    <nav
      aria-label={t("sessionPath", "Session path")}
      style={{
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        minWidth: 0,
        padding: "0 12px",
        height: 28,
        fontSize: "var(--text-meta)",
        color: "var(--fx-text-tertiary)",
        background: "var(--fx-surface-main)",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {items.map((item, index) => (
        <Fragment key={"gap" in item ? "gap" : item.session.id}>
          {index > 0 && <Separator />}
          {"gap" in item ? (
            <span aria-hidden="true">…</span>
          ) : item.isCurrent ? (
            <CurrentSegment session={item.session} />
          ) : (
            <PathSegment session={item.session} />
          )}
        </Fragment>
      ))}
    </nav>
  );
}

function CurrentSegment({ session }: { session: SessionInfo }) {
  return (
    <span
      aria-current="page"
      title={getSessionDisplayTitle(session, 240)}
      style={{
        color: "var(--fx-text-primary)",
        fontWeight: 500,
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: 200,
      }}
    >
      {getSessionDisplayTitle(session)}
    </span>
  );
}

function PathSegment({ session }: { session: SessionInfo }) {
  return (
    <button
      type="button"
      onClick={() => requestOpenSession(session.id)}
      title={getSessionDisplayTitle(session, 240)}
      style={{
        border: 0,
        padding: 0,
        background: "transparent",
        color: "var(--fx-text-tertiary)",
        cursor: "pointer",
        font: "inherit",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: 200,
        borderRadius: "var(--radius-chip)",
        transition: "color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.color = "var(--fx-text-primary)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = "var(--fx-text-tertiary)";
      }}
    >
      {getSessionDisplayTitle(session)}
    </button>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" style={{ color: "var(--fx-text-tertiary)", opacity: 0.55, padding: "0 4px" }}>
      ›
    </span>
  );
}

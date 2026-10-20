import { Fragment } from "react";
import { useI18n } from "@/i18n";
import { getSessionDisplayTitle } from "@/lib/session-list";
import { useSessionCatalog } from "@/lib/session-catalog";
import { sessionPath, type SessionPathSegment } from "@/lib/session-path";
import { requestOpenSession } from "@/lib/session-open-request";
import type { SessionInfo } from "@/lib/types";

// Where the conversation on screen sits: the chain of sessions that led to it.
// Every earlier step opens that session; the last step is the one you are
// reading. A session without a parent has no steps to climb, so it shows none.

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
        color: "var(--text-dim)",
        background: "var(--bg)",
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
        color: "var(--text)",
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
        color: "var(--text-dim)",
        cursor: "pointer",
        font: "inherit",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: 200,
        borderRadius: "var(--radius-chip)",
        transition: "color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = "var(--text-dim)";
      }}
    >
      {getSessionDisplayTitle(session)}
    </button>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" style={{ color: "var(--text-dim)", opacity: 0.55, padding: "0 4px" }}>
      ›
    </span>
  );
}

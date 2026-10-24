import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "@/i18n";
import { getSessionDisplayTitle } from "@/lib/session-list";
import { useSessionCatalog } from "@/lib/session-catalog";
import { sessionPath, type SessionPathSegment } from "@/lib/session-path";
import { requestOpenSession } from "@/lib/session-open-request";
import type { SessionInfo } from "@/lib/types";

type PathItem = SessionPathSegment | { gap: true };

const ELLIPSIS: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const CRUMB: CSSProperties = {
  ...ELLIPSIS,
  flexShrink: 1,
  maxWidth: 160,
  border: 0,
  padding: 0,
  background: "transparent",
  color: "var(--fx-text-tertiary)",
  fontFamily: "inherit",
  cursor: "pointer",
  transition: "color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
};

export function ProjectGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

export function PathChevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function SessionTitle({
  children,
  current = false,
  title,
}: {
  children: ReactNode;
  current?: boolean;
  title?: string;
}) {
  return (
    <span
      role="heading"
      aria-level={1}
      aria-current={current ? "page" : undefined}
      title={title}
      className="type-body-large-medium"
      style={{ ...ELLIPSIS, flexShrink: 1, color: "var(--fx-text-primary)" }}
    >
      {children}
    </span>
  );
}

export function SessionBreadcrumb({ session, compact = false }: { session: SessionInfo; compact?: boolean }) {
  const { t } = useI18n();
  const catalog = useSessionCatalog();
  const { segments, truncated } = sessionPath(session, catalog);
  const parents: PathItem[] = truncated
    ? [segments[0], { gap: true }, ...segments.slice(1, -1)]
    : segments.slice(0, -1);
  const items: PathItem[] = compact ? [] : parents;
  const current = segments[segments.length - 1].session;

  return (
    <nav
      aria-label={t("sessionPath", "Session path")}
      style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "0 1 auto" }}
    >
      {items.map((item, index) => (
        <Fragment key={"gap" in item ? "gap" : item.session.id}>
          {index > 0 && <PathChevron />}
          {"gap" in item ? (
            <span aria-hidden="true" style={{ color: "var(--fx-text-tertiary)" }}>
              …
            </span>
          ) : (
            <PathSegment session={item.session} />
          )}
        </Fragment>
      ))}
      {items.length > 0 && <PathChevron />}
      <SessionTitle current title={getSessionDisplayTitle(current, 240)}>
        {getSessionDisplayTitle(current)}
      </SessionTitle>
    </nav>
  );
}

function PathSegment({ session }: { session: SessionInfo }) {
  return (
    <button
      type="button"
      onClick={() => requestOpenSession(session.id)}
      title={getSessionDisplayTitle(session, 240)}
      className="type-body-large"
      style={CRUMB}
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

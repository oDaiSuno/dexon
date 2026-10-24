import type { MouseEvent, ReactNode } from "react";
import { ArrowUpRightIcon, ChevronLeftIcon, Icon } from "./icons";
import { KeyHint } from "./SendControls";

export const QUICK = "var(--duration-quick, 150ms) var(--ease-smooth-out, ease)";
export const HOVER = "var(--fx-surface-hover-overlay)";
export const CLEAR = "var(--fx-surface-hover-clear)";
export const paint = (e: MouseEvent<HTMLElement>, background: string) =>
  (e.currentTarget.style.background = background);

export interface MenuKeyHint {
  keyLabel: string;
  label: string;
}

export function MenuPanel({ label, role, children }: { label?: string; role?: "group" | "menu"; children: ReactNode }) {
  return (
    <div
      className="composer-pop-in"
      role={role ?? (label ? "group" : undefined)}
      aria-label={label}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        transformOrigin: "bottom center",
        display: "flex",
        flexDirection: "column",
        background: "var(--fx-surface-raised)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-composer)",
        boxShadow: "var(--shadow-popover)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

export function MenuHeader({
  sigil,
  title,
  titleMuted,
  query,
  note,
  count,
  announcement,
}: {
  sigil: string;
  title: string;
  titleMuted?: boolean;
  query?: string;
  note?: ReactNode;
  count: string;
  announcement?: string;
}) {
  const showQuery = Boolean(query);
  return (
    <div
      style={{
        height: 44,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 var(--space-3-5)",
        borderBottom: "1px solid var(--fx-line-default)",
      }}
    >
      <span
        aria-hidden
        className="type-mono-label"
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-chip)",
          background: "var(--fx-surface-inset)",
          color: "var(--fx-text-primary)",
        }}
      >
        {sigil}
      </span>
      {showQuery ? (
        <>
          <span
            className="type-mono-label"
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--fx-text-primary)",
            }}
          >
            {query}
          </span>
          <span
            aria-hidden
            style={{
              width: 1.5,
              height: 16,
              flexShrink: 0,
              borderRadius: "var(--radius-pill)",
              background: "var(--fx-accent-blue)",
            }}
          />
        </>
      ) : (
        <span
          className="type-body-medium"
          style={{ color: titleMuted ? "var(--fx-text-tertiary)" : "var(--fx-text-primary)" }}
        >
          {title}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {note}
      <span className="type-mono-meta" style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
        {count}
      </span>
      {announcement !== undefined && (
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      )}
    </div>
  );
}

export function MenuFooter({ hints, note, trailing }: { hints: MenuKeyHint[]; note?: string; trailing?: ReactNode }) {
  return (
    <div
      style={{
        height: 34,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "0 var(--space-3-5)",
        borderTop: "1px solid var(--fx-line-default)",
      }}
    >
      {hints.map((hint) => (
        <KeyHint key={hint.keyLabel} keyLabel={hint.keyLabel} label={hint.label} />
      ))}
      <span style={{ flex: 1 }} />
      {note && (
        <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {note}
        </span>
      )}
      {trailing}
    </div>
  );
}

export function MenuDivider() {
  return <span aria-hidden style={{ width: 1, height: 16, flexShrink: 0, background: "var(--fx-line-default)" }} />;
}

export function MenuBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        border: "none",
        borderRadius: "var(--radius-row)",
        background: "var(--fx-surface-hover-clear)",
        color: "var(--fx-text-secondary)",
        cursor: "pointer",
        transition: "background var(--duration-quick) var(--ease-smooth-out)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "var(--fx-surface-hover-clear)";
      }}
    >
      <ChevronLeftIcon size={16} />
    </button>
  );
}

export function MenuLinkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="type-label-default"
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: 0,
        border: "none",
        background: "none",
        color: "var(--fx-text-secondary)",
        cursor: "pointer",
      }}
    >
      {label}
      <span aria-hidden style={{ display: "flex", color: "var(--fx-text-tertiary)" }}>
        <ArrowUpRightIcon size={12} />
      </span>
    </button>
  );
}

export function MenuState({
  icon,
  title,
  description,
  tone = "default",
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  tone?: "default" | "danger";
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "28px var(--space-4) var(--space-6)",
        textAlign: "center",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-icon-box)",
          background: "var(--fx-surface-inset)",
          color: tone === "danger" ? "var(--fx-status-danger-text)" : "var(--fx-text-secondary)",
        }}
      >
        {icon}
      </span>
      <span aria-hidden style={{ width: 1, height: 6, flexShrink: 0 }} />
      <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
        {title}
      </span>
      {description && (
        <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {description}
        </span>
      )}
      {action && (
        <>
          <span aria-hidden style={{ width: 1, height: 8, flexShrink: 0 }} />
          {action}
        </>
      )}
    </div>
  );
}

export function SearchXIcon({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={1.75}>
      <path d="m13.5 8.5-5 5" />
      <path d="m8.5 8.5 5 5" />
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Icon>
  );
}

export function FileSearchIcon({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={1.75}>
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M4.268 21a2 2 0 0 0 1.727 1H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3" />
      <path d="m9 18-1.5-1.5" />
      <circle cx="5" cy="14" r="3" />
    </Icon>
  );
}

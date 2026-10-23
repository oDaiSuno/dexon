import type { ReactNode } from "react";
import { Icon } from "./icons";
import { KeyHint } from "./SendControls";

export interface MenuKeyHint {
  keyLabel: string;
  label: string;
}

export function MenuPanel({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div
      className="composer-pop-in"
      role={label ? "group" : undefined}
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
  count,
}: {
  sigil: string;
  title: string;
  titleMuted?: boolean;
  query?: string;
  count: string;
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
      <span className="type-mono-meta" style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
        {count}
      </span>
    </div>
  );
}

export function MenuFooter({ hints, note }: { hints: MenuKeyHint[]; note?: string }) {
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
    </div>
  );
}

export function MenuState({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
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
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-icon-box)",
          background: "var(--fx-surface-inset)",
          color: "var(--fx-text-secondary)",
        }}
      >
        {icon}
      </span>
      <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
        {title}
      </span>
      {description && (
        <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {description}
        </span>
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

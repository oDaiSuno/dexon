import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from "react";
import { SearchIcon } from "../chat-input/icons";

export const ACTION_ROW_HEIGHT = 36;

export const FOLDER_PATH = "M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z";
export const HOUSE_PATHS = [
  "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",
  "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
];

export const ELLIPSIS: CSSProperties = {
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export function MenuIcon({
  size = 16,
  strokeWidth = 2,
  style,
  children,
}: {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {children}
    </svg>
  );
}

export function iconBox(children: ReactNode) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        flexShrink: 0,
        color: "var(--fx-text-secondary)",
      }}
    >
      {children}
    </span>
  );
}

export const ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "0 10px",
  flexShrink: 0,
  background: "var(--fx-surface-hover-clear)",
  textAlign: "left",
};

export function SwitcherSearchRow({
  inputRef,
  value,
  label,
  shortcut,
  activeId,
  onChange,
  onKeyDown,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  label: string;
  shortcut: string;
  activeId?: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 36,
        padding: "0 10px",
        flexShrink: 0,
        borderBottom: "1px solid var(--fx-line-default)",
      }}
    >
      <span style={{ display: "flex", flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
        <SearchIcon size={15} strokeWidth={2} />
      </span>
      <input
        ref={inputRef}
        type="text"
        role="searchbox"
        spellCheck={false}
        autoComplete="off"
        aria-label={label}
        placeholder={label}
        aria-activedescendant={activeId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="type-body-default placeholder:text-[var(--fx-text-tertiary)]"
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          padding: 0,
          border: "none",
          background: "none",
          color: "var(--fx-text-primary)",
          caretColor: "var(--fx-accent-blue)",
          outline: "none",
        }}
      />
      <kbd
        aria-hidden="true"
        className="type-mono-meta"
        style={{
          flexShrink: 0,
          padding: "1px 6px",
          border: "1px solid var(--fx-line-strong)",
          borderRadius: "var(--radius-kbd)",
          color: "var(--fx-text-tertiary)",
        }}
      >
        {shortcut}
      </kbd>
    </div>
  );
}

export function SwitcherKeyHints({ hints }: { hints: { keyLabel: string; label: string }[] }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 10px 4px 10px",
        flexShrink: 0,
        borderTop: "1px solid var(--fx-line-default)",
      }}
    >
      {hints.map((hint) => (
        <span key={hint.keyLabel} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span className="type-mono-meta" style={{ color: "var(--fx-text-secondary)" }}>
            {hint.keyLabel}
          </span>
          <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
            {hint.label}
          </span>
        </span>
      ))}
    </div>
  );
}

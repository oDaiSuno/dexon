import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Toggle } from "../form-controls";
import { useI18n } from "@/i18n";
import { ProviderIcon } from "./provider-icon";

const iconProps = {
  "aria-hidden": true,
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const rowHover = {
  onMouseEnter: (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
  },
  onMouseLeave: (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = "var(--fx-surface-hover-clear)";
  },
};

export const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  border: "none",
  borderRadius: "var(--radius-control)",
  background: "var(--fx-surface-hover-clear)",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  transition: "background-color var(--duration-quick) var(--ease-smooth-out)",
};

export function EditableDialogTitle({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusBackRef = useRef(false);
  const label = t("modelRenameChannel", "Rename {name}").replace("{name}", value);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    if (focusBackRef.current) {
      focusBackRef.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const start = () => {
    focusBackRef.current = true;
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={t("modelChannelName", "Channel name")}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setEditing(false);
          }
        }}
        className="ui-input type-title-dialog"
        spellCheck={false}
        style={{ width: "100%", height: 28, minHeight: 28 }}
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      onClick={start}
      className="type-title-dialog"
      {...rowHover}
      style={{
        maxWidth: "100%",
        margin: "0 -4px",
        padding: "0 4px",
        border: "none",
        borderRadius: "var(--radius-chip)",
        background: "var(--fx-surface-hover-clear)",
        color: "var(--fx-text-primary)",
        font: "inherit",
        textAlign: "left",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        cursor: "text",
        transition: "background-color var(--duration-quick) var(--ease-smooth-out)",
      }}
    >
      {value}
    </button>
  );
}

export function DialogLogoTile({ id }: { id: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 40,
        height: 40,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-card)",
        background: "var(--fx-surface-card)",
        boxSizing: "border-box",
      }}
    >
      <ProviderIcon id={id} size={20} />
    </span>
  );
}

export function DetailSections({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>{children}</div>;
}

export function DetailSection({
  title,
  gap,
  aside,
  children,
}: {
  title: string;
  gap: number;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: aside ? 32 : undefined }}>
        <h3 className="type-body-large-medium" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function FieldHint({ children }: { children: string }) {
  return (
    <span className="type-body-default" style={{ color: "var(--fx-text-tertiary)", textWrap: "pretty" }}>
      {children}
    </span>
  );
}

export function SectionCount({ children }: { children: ReactNode }) {
  return (
    <span className="type-body-default" style={{ flex: 1, minWidth: 0, color: "var(--fx-text-tertiary)" }}>
      {children}
    </span>
  );
}

function ChevronRightIcon() {
  return (
    <svg {...iconProps} style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ModelId({ id, enabled, placeholder }: { id: string; enabled: boolean; placeholder?: string }) {
  return (
    <span
      className="type-mono-body"
      style={{
        flex: 1,
        minWidth: 0,
        color: !id ? "var(--fx-text-tertiary)" : enabled ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {id || placeholder}
    </span>
  );
}

const modelRowStyle: CSSProperties = {
  ...rowStyle,
  height: 44,
  padding: "0 8px 0 4px",
};

const dividerStyle = (divider: boolean): CSSProperties =>
  divider ? { boxShadow: "inset 0 1px 0 var(--fx-line-default)" } : {};

export interface ModelRowToggle {
  checked: boolean;
  disabled: boolean;
  title?: string;
  onChange: (enabled: boolean) => void;
}

export function ModelToggleRow({
  id,
  title,
  toggle,
  divider,
}: {
  id: string;
  title?: string;
  toggle: ModelRowToggle;
  divider: boolean;
}) {
  return (
    <label
      title={title}
      {...rowHover}
      style={{
        ...modelRowStyle,
        ...dividerStyle(divider),
        cursor: toggle.disabled ? "not-allowed" : "pointer",
      }}
    >
      <Toggle
        checked={toggle.checked}
        disabled={toggle.disabled}
        onChange={(event) => toggle.onChange(event.target.checked)}
      />
      <ModelId id={id} enabled={toggle.checked} />
    </label>
  );
}

export function ModelOpenRow({
  id,
  placeholder,
  meta,
  toggle,
  toggleLabel,
  divider,
  onOpen,
}: {
  id: string;
  placeholder: string;
  meta: string;
  toggle: ModelRowToggle;
  toggleLabel: string;
  divider: boolean;
  onOpen: () => void;
}) {
  return (
    <div {...rowHover} style={{ ...modelRowStyle, ...dividerStyle(divider), cursor: "default" }}>
      <span title={toggle.title} style={{ display: "inline-flex", flexShrink: 0 }}>
        <Toggle
          checked={toggle.checked}
          disabled={toggle.disabled}
          aria-label={toggleLabel}
          onChange={(event) => toggle.onChange(event.target.checked)}
        />
      </span>
      <button
        type="button"
        onClick={onOpen}
        style={{ ...rowStyle, flex: 1, minWidth: 0, height: "100%", padding: 0, background: "none" }}
      >
        <ModelId id={id} enabled={toggle.checked} placeholder={placeholder} />
        {meta && (
          <span className="type-body-default" style={{ color: "var(--fx-text-tertiary)", whiteSpace: "nowrap" }}>
            {meta}
          </span>
        )}
        <ChevronRightIcon />
      </button>
    </div>
  );
}

export function AddModelRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rowHover}
      style={{ ...rowStyle, gap: 8, height: 40, padding: "0 4px", color: "var(--fx-text-secondary)" }}
    >
      <svg {...iconProps} style={{ flexShrink: 0 }}>
        <path d="M12 5v14M5 12h14" />
      </svg>
      <span className="type-body-default">{label}</span>
    </button>
  );
}

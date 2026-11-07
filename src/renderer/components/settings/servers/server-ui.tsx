import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";

export const serverPanelStyle: CSSProperties = {
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-card)",
  background: "var(--fx-surface-raised)",
  overflow: "hidden",
};

export const serverStackStyle: CSSProperties = { display: "grid", gap: "var(--space-4)", padding: "var(--space-5)" };
export const serverRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  flexWrap: "wrap",
};

export function ServerIcon({ tone = "accent", size = 38 }: { tone?: "accent" | "warning" | "danger"; size?: number }) {
  const tones = {
    accent: {
      background: "var(--fx-accent-blue-soft)",
      color: "var(--fx-accent-blue-text)",
      borderColor: "var(--fx-accent-blue-border)",
    },
    warning: {
      background: "var(--fx-status-warning-soft)",
      color: "var(--fx-status-warning-text)",
      borderColor: "var(--fx-status-warning-border)",
    },
    danger: {
      background: "var(--fx-status-danger-soft)",
      color: "var(--fx-status-danger-text)",
      borderColor: "var(--fx-status-danger-border)",
    },
  };
  return (
    <span
      style={{
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "var(--radius-card)",
        border: "1px solid",
        ...tones[tone],
      }}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="4" y="3" width="16" height="7" rx="2" />
        <rect x="4" y="14" width="16" height="7" rx="2" />
        <path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" />
      </svg>
    </span>
  );
}

export function ServerFooter({ children, leading }: { children: ReactNode; leading?: ReactNode }) {
  return (
    <footer
      style={{
        ...serverRowStyle,
        justifyContent: "flex-end",
        padding: "var(--space-3) var(--space-5)",
        borderTop: "1px solid var(--fx-line-default)",
        background: "var(--fx-surface-main)",
        flexShrink: 0,
      }}
    >
      <div style={{ flex: 1 }}>{leading}</div>
      {children}
    </footer>
  );
}

export function ServerActionError({ error }: { error: string | null }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <p
      role="alert"
      className="type-body-default"
      style={{
        margin: 0,
        padding: "var(--space-3)",
        borderRadius: "var(--radius-control)",
        background: "var(--fx-status-danger-soft)",
        color: "var(--fx-status-danger-text)",
        overflowWrap: "anywhere",
      }}
    >
      {t("serversActionFailed", "The server action failed. Check the details and try again.")} {error}
    </p>
  );
}

export function ServerTabs<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: "flex",
        gap: "var(--space-1)",
        padding: "var(--space-1)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-segmented)",
        background: "var(--fx-surface-inset)",
      }}
    >
      {options.map((option) => (
        <Button
          key={option.value}
          variant="ghost"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          style={{
            flex: 1,
            minWidth: 0,
            background: option.value === value ? "var(--fx-surface-raised)" : undefined,
            boxShadow: option.value === value ? "var(--shadow-control)" : undefined,
            borderRadius: "var(--radius-segment)",
          }}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

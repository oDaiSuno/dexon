import { useI18n } from "@/i18n";
import { BrowserIcon } from "./browser-icons";

export function BrowserTakeoverPill({ onTakeOver }: { onTakeOver: () => void }) {
  const { t } = useI18n();
  const label = t("browserTakeOverAction", "Take over");
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 16,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      <button
        type="button"
        className="browser-takeover-pill"
        aria-label={label}
        title={label}
        onClick={onTakeOver}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 40,
          padding: "0 6px 0 12px",
          border: "none",
          borderRadius: "var(--radius-menu)",
          background: "var(--fx-surface-inverse)",
          boxShadow: "0 12px 32px 0 var(--fx-shadow-strong), 0 0 0 1px var(--fx-line-translucent)",
          cursor: "pointer",
          pointerEvents: "auto",
        }}
      >
        <span
          className="browser-live-dot"
          style={{
            flexShrink: 0,
            width: 8,
            height: 8,
            borderRadius: 4,
            background: "var(--fx-accent-blue)",
          }}
        />
        <span className="type-label-medium" style={{ color: "var(--fx-text-inverse)", whiteSpace: "nowrap" }}>
          {t("browserAgentWorking", "Agent is working")}
        </span>
        <span
          className="browser-takeover-chip"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            padding: "0 10px",
            borderRadius: "var(--radius-control)",
          }}
        >
          <span style={{ display: "flex", flexShrink: 0, color: "var(--fx-text-inverse)" }}>
            <BrowserIcon name="hand" size={13} strokeWidth={2} />
          </span>
          <span className="type-label-medium" style={{ color: "var(--fx-text-inverse)" }}>
            {label}
          </span>
        </span>
        <kbd
          className="type-mono-meta"
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            height: 18,
            padding: "0 5px",
            border: "1px solid color-mix(in srgb, var(--fx-text-tertiary) 40%, transparent)",
            borderRadius: "var(--radius-xs)",
            color: "var(--fx-text-faint)",
          }}
        >
          {"Esc"}
        </kbd>
      </button>
    </div>
  );
}

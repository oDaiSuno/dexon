import type { CSSProperties } from "react";
import { useI18n } from "@/i18n";
import { ArrowUpIcon, StopIcon } from "./icons";
import type { SendGate } from "@/lib/space-attribution";

function squareBase(): CSSProperties {
  return {
    flexShrink: 0,
    alignSelf: "flex-end",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    padding: 0,
    border: "none",
    borderRadius: "var(--radius-send)",
    transition:
      "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), border-color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), transform var(--duration-micro, 80ms)",
  };
}

export function SendSquare({ armed, onSend, gate }: { armed: boolean; onSend: () => void; gate?: SendGate | null }) {
  const { t } = useI18n();
  const blocked = gate ? !gate.allowed : false;
  const disabled = !armed || blocked;
  const label = blocked && gate ? gate.label : t("send", "Send");
  const hint = blocked && gate ? gate.hint : undefined;

  return (
    <button
      type="button"
      aria-label={label}
      title={hint}
      disabled={disabled}
      onClick={onSend}
      style={{
        ...squareBase(),
        background: armed && !blocked ? "var(--fx-surface-inverse)" : "var(--fx-surface-selected)",
        color: armed && !blocked ? "var(--fx-text-inverse)" : "var(--fx-text-tertiary)",
        cursor: armed && !blocked ? "pointer" : "not-allowed",
      }}
      onMouseEnter={(e) => {
        if (armed && !blocked) e.currentTarget.style.background = "var(--fx-surface-inverse-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background =
          armed && !blocked ? "var(--fx-surface-inverse)" : "var(--fx-surface-selected)";
      }}
      className="tap-scale"
    >
      <ArrowUpIcon size={16} />
    </button>
  );
}

export function StopSquare({ onAbort }: { onAbort: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t("stopAgent", "Stop agent")}
      title={t("stopAgent", "Stop agent")}
      onClick={onAbort}
      style={{
        ...squareBase(),
        background: "var(--fx-surface-inverse)",
        color: "var(--fx-text-inverse)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--fx-surface-inverse-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--fx-surface-inverse)";
      }}
      className="tap-scale"
    >
      <StopIcon />
    </button>
  );
}

export function KeyHint({ keyLabel, label }: { keyLabel: string; label: string }) {
  return (
    <span className="composer-key-hint type-meta-default">
      <kbd className="type-mono-meta">{keyLabel}</kbd>
      {label}
    </span>
  );
}

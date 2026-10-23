import type { CSSProperties } from "react";
import { useI18n } from "@/i18n";
import { ArrowUpIcon, StopIcon } from "./icons";

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
    borderRadius: "var(--radius-control)",
    transition:
      "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), border-color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), transform var(--duration-micro, 80ms)",
  };
}

/** 32×32 tactile send square. Inverse-ink filled when armed, quiet gray
 *  when the draft is empty. */
export function SendSquare({ armed, onSend }: { armed: boolean; onSend: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t("send", "Send")}
      disabled={!armed}
      onClick={onSend}
      style={{
        ...squareBase(),
        background: armed ? "var(--fx-surface-inverse)" : "var(--fx-surface-selected)",
        color: armed ? "var(--fx-text-inverse)" : "var(--fx-text-tertiary)",
        cursor: armed ? "pointer" : "not-allowed",
      }}
      onMouseEnter={(e) => {
        if (armed) e.currentTarget.style.background = "var(--fx-surface-inverse-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = armed ? "var(--fx-surface-inverse)" : "var(--fx-surface-selected)";
      }}
      className="tap-scale"
    >
      <ArrowUpIcon size={16} />
    </button>
  );
}

/** While streaming with an empty draft, the send slot becomes a stop
 *  button — same 32×32 square, radius, and inverse ink as the send
 *  square; only the glyph changes (white stop mark). */
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

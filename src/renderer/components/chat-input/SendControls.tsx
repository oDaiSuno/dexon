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
    height: 28,
    padding: 0,
    transition: "background 0.15s, color 0.15s, border-color 0.15s, transform 0.12s",
  };
}

/** 28×28 tactile send square. Ink-filled when armed (black/white inversion,
 *  per the design system), quiet gray when the draft is empty. */
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
        width: 28,
        border: "none",
        borderRadius: "var(--radius-control)",
        background: armed ? "var(--btn-bg)" : "var(--bg-hover)",
        color: armed ? "var(--btn-fg)" : "var(--text-dim)",
        cursor: armed ? "pointer" : "not-allowed",
      }}
      onMouseEnter={(e) => {
        if (armed) e.currentTarget.style.background = "var(--btn-bg-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = armed ? "var(--btn-bg)" : "var(--bg-hover)";
      }}
      className="tap-scale"
    >
      <ArrowUpIcon size={16} />
    </button>
  );
}

/** While streaming with an empty draft, the send slot becomes a stop
 *  button — same 28×28 square, radius, and ink inversion as the send
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
        width: 28,
        border: "none",
        borderRadius: "var(--radius-control)",
        background: "var(--btn-bg)",
        color: "var(--btn-fg)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--btn-bg-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--btn-bg)";
      }}
      className="tap-scale"
    >
      <StopIcon size={11} />
    </button>
  );
}

import { useEffect, useRef, useState } from "react";

// Split from worktree-switcher.tsx in Phase 2: the inactive worktree selector
// hint shown when the switcher is unavailable; clicking reveals the reason.

export function WorktreeInactiveHint({ hint }: { hint: { label: string; title: string } | null }) {
  const [wtGuideHintOpen, setWtGuideHintOpen] = useState(false);
  const wtGuideHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (wtGuideHintTimerRef.current) clearTimeout(wtGuideHintTimerRef.current);
    },
    [],
  );

  // The hint is always mounted (the composition renders it unconditionally) so
  // an opened hint and its pending 4s timer survive project switches exactly as
  // they did when this state lived in the original always-mounted sidebar
  // (review R2 finding 1). Hooks stay unconditional; only the output hides.
  if (!hint) return null;

  return (
    <>
      <button
        type="button"
        aria-disabled="true"
        tabIndex={-1}
        title={hint.title}
        onClick={() => {
          // No action is available here; clicking reveals the reason
          setWtGuideHintOpen(true);
          if (wtGuideHintTimerRef.current) clearTimeout(wtGuideHintTimerRef.current);
          wtGuideHintTimerRef.current = setTimeout(() => {
            wtGuideHintTimerRef.current = null;
            setWtGuideHintOpen(false);
          }, 4000);
        }}
        style={{
          width: "100%",
          height: 29,
          boxSizing: "border-box",
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
          background: "var(--bg-hover)",
          color: "var(--fx-text-tertiary)",
          fontSize: "var(--text-meta)",
          lineHeight: 1.35,
          whiteSpace: "nowrap",
          textAlign: "left",
          cursor: "default",
          opacity: 0.82,
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{hint.label}</span>
      </button>
      {wtGuideHintOpen && (
        <div
          style={{
            marginTop: 4,
            padding: "8px 12px",
            fontSize: "var(--text-meta)",
            lineHeight: 1.45,
            color: "var(--fx-text-secondary)",
            background: "var(--bg-hover)",
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-card)",
          }}
        >
          {hint.title}
        </div>
      )}
    </>
  );
}

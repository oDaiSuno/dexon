import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n";

// Moved verbatim from SessionSidebar.tsx in Phase 2 (session row split).
// Phase 4 (review R2): the built-in SVG (SMIL) animations ignore CSS
// prefers-reduced-motion handling, so under the reduced-motion preference the
// indicators render their static, still-recognizable marks instead of the
// animated ones. Normal (non-reduced) rendering is unchanged.

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getMatches(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCE_QUERY).matches;
}

function getMatchesServer(): boolean {
  return false;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getMatches, getMatchesServer);
}

export function RunningSessionIndicator() {
  const { t } = useI18n();
  const reduced = usePrefersReducedMotion();
  return (
    <span
      title={t("agentRunning", "Agent is running…")}
      aria-label={t("agentRunningStatus", "Agent running")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
          {!reduced && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 12 12"
              to="360 12 12"
              dur="0.9s"
              repeatCount="indefinite"
            />
          )}
        </g>
      </svg>
    </span>
  );
}

export function UnreadSessionIndicator() {
  const { t } = useI18n();
  const reduced = usePrefersReducedMotion();
  return (
    <span
      title={t("newSessionActivity", "New activity")}
      aria-label={t("newSessionActivityLabel", "New session activity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32">
          {!reduced && <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />}
          {!reduced && <animate attributeName="opacity" values="0.32;0;0.32" dur="1.6s" repeatCount="indefinite" />}
        </circle>
      </svg>
    </span>
  );
}

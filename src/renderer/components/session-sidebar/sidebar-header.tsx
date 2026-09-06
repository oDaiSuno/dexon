import { useI18n } from "@/i18n";
import { PiAgentTitle } from "./pi-agent-title";

// Split from SessionSidebar.tsx in Phase 2: the sidebar header (app title,
// refresh feedback, new session button). State is owned by the composition
// root; this component renders it.

export function SidebarHeader({
  selectedCwd,
  sessionRefreshDone,
  onRefresh,
  onNewSession,
}: {
  selectedCwd: string | null;
  sessionRefreshDone: boolean;
  onRefresh: () => void;
  onNewSession: () => void;
}) {
  const { t } = useI18n();

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <PiAgentTitle />
        <button
          onClick={onRefresh}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: sessionRefreshDone ? "color-mix(in srgb, var(--success) 18%, transparent)" : "var(--bg-hover)",
            border: `1px solid ${sessionRefreshDone ? "color-mix(in srgb, var(--success) 40%, transparent)" : "var(--border)"}`,
            color: sessionRefreshDone ? "var(--success)" : "var(--text-muted)",
            cursor: "pointer",
            width: 32,
            height: 32,
            borderRadius: "var(--radius-card)",
            padding: 0,
            flexShrink: 0,
            transition: "background 0.3s, color 0.3s, border-color 0.3s",
          }}
          onMouseEnter={(e) => {
            if (sessionRefreshDone) return;
            e.currentTarget.style.background = "var(--bg-selected)";
            e.currentTarget.style.color = "var(--accent)";
            e.currentTarget.style.borderColor = "var(--accent-soft-border)";
          }}
          onMouseLeave={(e) => {
            if (sessionRefreshDone) return;
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-muted)";
            e.currentTarget.style.borderColor = "var(--border)";
          }}
          title={t("refresh", "Refresh")}
        >
          {sessionRefreshDone ? (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--success)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          )}
        </button>
      </div>

      <button
        onClick={onNewSession}
        disabled={!selectedCwd}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          padding: "8px 12px",
          background: selectedCwd ? "var(--text)" : "var(--bg-hover)",
          border: "none",
          color: selectedCwd ? "var(--bg)" : "var(--text-dim)",
          cursor: selectedCwd ? "pointer" : "not-allowed",
          borderRadius: "var(--radius-card)",
          fontSize: "var(--text-label)",
          fontWeight: 600,
          fontFamily: "var(--font-mono)",
          flexShrink: 0,
          transition: "opacity var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
          opacity: selectedCwd ? 1 : 0.7,
        }}
        title={
          selectedCwd
            ? `${t("newSessionIn", "New session in selected project")}: ${selectedCwd}`
            : t("selectProjectFirst", "Select a project first")
        }
        onMouseEnter={(e) => {
          if (!selectedCwd) return;
          e.currentTarget.style.opacity = "0.9";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = selectedCwd ? "1" : "0.7";
        }}
      >
        <span style={{ fontSize: "var(--text-body-lg)", lineHeight: 1 }}>+</span>
        {t("newSession", "new session")}
      </button>
    </>
  );
}

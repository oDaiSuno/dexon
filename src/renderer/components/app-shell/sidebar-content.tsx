import { useI18n } from "@/i18n";
import { SessionSidebar } from "../SessionSidebar";
import type { SessionInfo } from "@/lib/types";

// Split from AppShell.tsx in Phase 2: the left sidebar column content (history
// sidebar plus the settings entry button). Presentation only.

export function SidebarContent({
  selectedSessionId,
  onSelectSession,
  onNewSession,
  initialSessionId,
  onInitialRestoreDone,
  refreshKey,
  onSessionDeleted,
  selectedCwd,
  onCwdChange,
  onOpenSettings,
}: {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession: (sessionId: string, cwd: string) => void;
  initialSessionId: string | null;
  onInitialRestoreDone: () => void;
  refreshKey: number;
  onSessionDeleted: (sessionId: string) => void;
  selectedCwd: string | null;
  onCwdChange: (cwd: string | null, projectRoot?: string | null) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();

  return (
    <>
      <SessionSidebar
        selectedSessionId={selectedSessionId}
        onSelectSession={onSelectSession}
        onNewSession={onNewSession}
        initialSessionId={initialSessionId}
        onInitialRestoreDone={onInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={onSessionDeleted}
        selectedCwd={selectedCwd}
        onCwdChange={onCwdChange}
      />
      <div style={{ padding: "8px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={onOpenSettings}
          title={t("settings", "Settings")}
          style={{
            width: "100%",
            height: 34,
            padding: "0 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: "none",
            border: "none",
            borderRadius: "var(--radius-card)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "var(--text-label)",
            transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.38.33.72.6 1 .3.29.69.42 1.1.4h.09v4h-.09a1.7 1.7 0 0 0-1.7.6Z" />
          </svg>
          {t("settings", "Settings")}
        </button>
      </div>
    </>
  );
}

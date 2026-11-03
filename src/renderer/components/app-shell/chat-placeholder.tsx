import { useI18n } from "@/i18n";
import { requestProjectSwitcher } from "@/lib/project-switcher-request";
import type { ProjectFolderActions } from "./use-project-folder-actions";

// Split from AppShell.tsx in Phase 2: the chat area placeholder states shown
// when no session is open. Pure presentation.

export function ChatPlaceholder({
  activeCwd,
  folderActions,
}: {
  activeCwd: string | null;
  folderActions: Pick<ProjectFolderActions, "chooseFolder" | "error">;
}) {
  const { t } = useI18n();

  if (activeCwd) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--fx-text-secondary)",
          fontSize: "var(--text-title)",
        }}
      >
        {t("selectSession", "Select a session from the sidebar")}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      <svg
        width="44"
        height="44"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--fx-accent-blue)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.7, flexShrink: 0 }}
      >
        <line x1="20" y1="12" x2="4" y2="12" />
        <polyline points="10 6 4 12 10 18" />
      </svg>
      <div>
        <div
          style={{
            fontSize: "var(--text-heading-lg)",
            fontWeight: 600,
            color: "var(--fx-text-primary)",
            marginBottom: 8,
          }}
        >
          {t("getStarted", "Get Started")}
        </div>
        <div style={{ fontSize: "var(--text-label)", color: "var(--fx-text-secondary)", lineHeight: 1.8 }}>
          <span style={{ color: "var(--fx-text-tertiary)", marginRight: 8 }}>1.</span>
          {t("selectProject", "Select a project directory from the sidebar")}
          <br />
          <span style={{ color: "var(--fx-text-tertiary)", marginRight: 8 }}>2.</span>
          {t("addModelsFromSettings", "Open Settings at the bottom, then add models")}
        </div>
        <p className="type-body-relaxed" style={{ maxWidth: 420, marginTop: 12, color: "var(--fx-text-secondary)" }}>
          {t(
            "sshConnectWelcome",
            "You can open a folder on this computer, or connect straight to a project folder on a remote Linux server (model keys and chat history always stay on this computer).",
          )}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, pointerEvents: "auto" }}>
          <button
            type="button"
            className="type-body-medium"
            onClick={folderActions.chooseFolder}
            style={{
              padding: "8px 12px",
              borderRadius: "var(--radius-control)",
              background: "var(--fx-surface-card)",
              color: "var(--fx-text-primary)",
              border: "1px solid var(--fx-line-default)",
            }}
          >
            {t("sshConnectLocalFolder", "Choose a local folder…")}
          </button>
          <button
            type="button"
            className="type-body-medium"
            onClick={() => requestProjectSwitcher({ mode: "ssh" })}
            style={{
              padding: "8px 12px",
              borderRadius: "var(--radius-control)",
              background: "var(--fx-accent-blue)",
              color: "var(--fx-text-on-accent)",
            }}
          >
            {t("sshConnectEntry", "Connect remote server (SSH)…")}
          </button>
        </div>
        {folderActions.error && (
          <p role="alert" className="type-meta-default" style={{ marginTop: 8, color: "var(--fx-status-danger-text)" }}>
            {folderActions.error}
          </p>
        )}
      </div>
    </div>
  );
}

import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import type { MissingFolderRecovery } from "./types";

export function MissingSessionFolderBar({ recovery }: { recovery?: MissingFolderRecovery }) {
  const { t } = useI18n();
  return (
    <section
      role="status"
      className="type-body-default"
      style={{
        marginBottom: "var(--space-3)",
        padding: "var(--space-3)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-card)",
        background: "var(--fx-surface-card)",
        color: "var(--fx-text-secondary)",
      }}
    >
      <p style={{ margin: 0 }}>
        {t(
          "missingSessionFolderReadOnly",
          "The original project folder no longer exists. This historical conversation is protected as read-only.",
        )}
      </p>
      {recovery && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
          <Button disabled={recovery.pending} onClick={recovery.chooseExistingFolder}>
            {t("missingSessionFolderChoose", "Choose existing folder for new chat")}
          </Button>
          <Button disabled={recovery.pending} onClick={recovery.newDefaultChat}>
            {t("missingSessionFolderDefault", "New chat in default space")}
          </Button>
        </div>
      )}
      {recovery?.error && (
        <p role="alert" className="type-meta-default">
          {recovery.error}
        </p>
      )}
    </section>
  );
}

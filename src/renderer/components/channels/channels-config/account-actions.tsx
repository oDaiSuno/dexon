import type { ChannelAccountConfig, ChannelStatus } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { buttonStyle } from "./control-styles";

export function AccountActions({
  draft,
  status,
  busy,
  probing,
  onSave,
  onStart,
  onStop,
  onRestart,
  onProbe,
  onDelete,
}: {
  draft: ChannelAccountConfig;
  status?: ChannelStatus;
  busy: boolean;
  probing: boolean;
  onSave: (account: ChannelAccountConfig) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onProbe: () => Promise<void>;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
      <button
        type="button"
        disabled={busy}
        style={buttonStyle(true)}
        onClick={() => {
          const elevated =
            draft.dmPolicy === "open" ||
            draft.groupPolicy === "open" ||
            draft.commandsEnabled === true ||
            draft.toolNames.includes("bash") ||
            draft.toolNames.includes("write");
          if (
            elevated &&
            !window.confirm(
              t(
                "elevatedChannelConfirm",
                "This configuration allows remote messages to reach powerful local capabilities. Confirm that the account and allowed users are trusted.",
              ),
            )
          ) {
            return;
          }
          onSave(draft);
        }}
      >
        {t("save", "Save")}
      </button>
      {status?.state === "running" ? (
        <button type="button" disabled={busy} style={buttonStyle()} onClick={onStop}>
          {t("stop", "Stop")}
        </button>
      ) : (
        <button type="button" disabled={busy || !draft.enabled} style={buttonStyle()} onClick={onStart}>
          {t("start", "Start")}
        </button>
      )}
      <button type="button" disabled={busy} style={buttonStyle()} onClick={onRestart}>
        {t("restart", "Restart")}
      </button>
      <button
        type="button"
        disabled={busy || probing}
        style={{ ...buttonStyle(), opacity: probing ? 0.65 : 1 }}
        onClick={() => void onProbe()}
      >
        {probing ? t("testingConnection", "Testing…") : t("testConnection", "Test connection")}
      </button>
      <button
        type="button"
        disabled={busy}
        style={{ ...buttonStyle(), color: "var(--fx-status-danger)" }}
        onClick={onDelete}
      >
        {t("delete", "Delete")}
      </button>
    </div>
  );
}

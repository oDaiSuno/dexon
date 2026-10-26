import type { ChannelAccountConfig, ChannelStatus } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";
import { PlugIcon, RefreshIcon, TrashIcon } from "./channel-icons";
import type { Translate } from "./channel-labels";

export function isElevated(draft: ChannelAccountConfig): boolean {
  return (
    draft.dmPolicy === "open" ||
    draft.groupPolicy === "open" ||
    draft.commandsEnabled === true ||
    draft.toolNames.includes("bash") ||
    draft.toolNames.includes("write")
  );
}

export function confirmSave(draft: ChannelAccountConfig, t: Translate): boolean {
  return (
    !isElevated(draft) ||
    window.confirm(
      t(
        "elevatedChannelConfirm",
        "This configuration allows remote messages to reach powerful local capabilities. Confirm that the account and allowed users are trusted.",
      ),
    )
  );
}

export function AccountActions({
  draft,
  status,
  busy,
  probing,
  onStart,
  onStop,
  onRestart,
  onProbe,
}: {
  draft: ChannelAccountConfig;
  status?: ChannelStatus;
  busy: boolean;
  probing: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onProbe: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      {status?.state === "running" ? (
        <Button disabled={busy} onClick={onStop}>
          {t("stop", "Stop")}
        </Button>
      ) : (
        <Button disabled={busy || !draft.enabled} onClick={onStart}>
          {t("start", "Start")}
        </Button>
      )}
      <Button disabled={busy} onClick={onRestart}>
        <RefreshIcon />
        {t("restart", "Reconnect")}
      </Button>
      <Button disabled={busy || probing} busy={probing} onClick={() => void onProbe()}>
        <PlugIcon />
        {probing ? t("testingConnection", "Testing…") : t("testConnection", "Test connection")}
      </Button>
    </div>
  );
}

export function AccountFooter({
  busy,
  onDelete,
  onCancel,
  onSave,
}: {
  busy: boolean;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 16px 12px 12px",
        borderTop: "1px solid var(--fx-line-default)",
        background: "var(--fx-surface-raised)",
        flexShrink: 0,
      }}
    >
      <Button variant="ghost" disabled={busy} onClick={onDelete}>
        <TrashIcon />
        {t("delete", "Delete")}
      </Button>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" onClick={onCancel}>
        {t("cancel", "Cancel")}
      </Button>
      <Button variant="primary" disabled={busy} onClick={onSave}>
        {t("save", "Save")}
      </Button>
    </footer>
  );
}

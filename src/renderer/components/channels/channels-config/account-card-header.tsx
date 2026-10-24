import type { ChannelAccountConfig, ChannelAccountView, ChannelStatus } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Badge, Toggle } from "../../form-controls";
import { accountPresence } from "./channel-presentation";

export function AccountCardHeader({
  account,
  status,
  draft,
  setDraft,
}: {
  account: ChannelAccountView;
  status?: ChannelStatus;
  draft: ChannelAccountConfig;
  setDraft: (draft: ChannelAccountConfig) => void;
}) {
  const { t } = useI18n();
  const presence = accountPresence(status, t);
  const identity = [
    account.credentialFingerprint ?? t("notConfigured", "not configured"),
    account.providerUsername,
    account.providerAccountId,
  ].filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Badge tone={presence.tone}>{presence.label}</Badge>
        <span
          className="type-mono-meta"
          style={{
            flex: 1,
            minWidth: 0,
            color: "var(--fx-text-tertiary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {identity.join(" · ")}
        </span>
        <label
          className="type-body-medium"
          style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--fx-text-primary)", cursor: "pointer" }}
        >
          <Toggle checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
          {t("enabled", "Enabled")}
        </label>
      </div>
      {status?.lastError && (
        <div className="type-label-default" role="status" style={{ color: "var(--fx-status-warning-text)" }}>
          {status.lastError}
        </div>
      )}
    </div>
  );
}

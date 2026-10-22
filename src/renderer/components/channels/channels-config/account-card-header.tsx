import type { ChannelAccountConfig, ChannelAccountView, ChannelStatus } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { channelAccent, channelLabel, channelStatusLabel, statusColor } from "./channel-labels";

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
  const accent = channelAccent(account.channel);
  const label = channelLabel(account.channel, t, account.domain);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "var(--radius-card)",
            display: "grid",
            placeItems: "center",
            background: `color-mix(in srgb, ${accent} 12%, transparent)`,
            color: accent,
            fontWeight: 800,
          }}
        >
          {account.channel === "telegram"
            ? "TG"
            : account.channel === "feishu"
              ? account.domain === "lark"
                ? "L"
                : "飞"
              : "微"}
        </div>
        <div>
          <div style={{ color: "var(--fx-text-primary)", fontSize: "var(--text-body)", fontWeight: 700 }}>
            {account.name}
          </div>
          <div style={{ color: statusColor(status), fontSize: "var(--text-meta)", marginTop: 2 }}>
            {channelStatusLabel(status?.state ?? "stopped", t)} ·{" "}
            {account.credentialFingerprint ?? t("notConfigured", "not configured")}
          </div>
          <div style={{ color: "var(--fx-text-tertiary)", fontSize: "var(--text-micro)", marginTop: 2 }}>
            {label}
            {account.providerUsername ? ` · ${account.providerUsername}` : ""}
            {account.providerAccountId ? ` · ${account.providerAccountId}` : ""}
          </div>
        </div>
      </div>
      <label
        style={{
          fontSize: "var(--text-meta)",
          color: "var(--fx-text-secondary)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          style={{ width: 18, height: 18, margin: 0, accentColor: "var(--fx-accent-blue)", cursor: "pointer" }}
        />{" "}
        {t("enabled", "Enabled")}
      </label>
    </div>
  );
}

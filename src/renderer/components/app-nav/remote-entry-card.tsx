import { useState } from "react";
import type { ChannelId, ChannelsSnapshot } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Badge } from "../form-controls";
import { ChannelBrandMark } from "../channels/channel-brand-mark";

const SUPPORTED_CHANNELS: ChannelId[] = ["weixin", "telegram", "feishu"];

function SmartphoneIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function shownChannels(snapshot: ChannelsSnapshot): ChannelId[] {
  const configured = new Set(snapshot.accounts.map((account) => account.channel));
  return configured.size === 0 ? SUPPORTED_CHANNELS : SUPPORTED_CHANNELS.filter((id) => configured.has(id));
}

function offlineCount(snapshot: ChannelsSnapshot): number {
  return snapshot.accounts.filter(
    (account) =>
      account.enabled && !snapshot.statuses.some((status) => status.accountId === account.id && status.connected),
  ).length;
}

export function RemoteEntryCard({ snapshot, onOpen }: { snapshot: ChannelsSnapshot; onOpen: () => void }) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const connected = snapshot.bindings.length;
  const offline = offlineCount(snapshot);
  const title = t("channels", "Remote chat");

  return (
    <section aria-labelledby="resource-builtin-heading" style={{ display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", height: 32 }}>
        <h2
          id="resource-builtin-heading"
          className="type-title-dialog"
          style={{ margin: 0, color: "var(--fx-text-primary)" }}
        >
          {t("builtInPlugins", "Built-in plugins")}
        </h2>
        <span className="type-body-default" style={{ color: "var(--fx-text-tertiary)" }}>
          1
        </span>
      </div>
      <button
        type="button"
        aria-label={title}
        onClick={onOpen}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          width: "100%",
          padding: "var(--space-4)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-resource-card)",
          background: hovered ? "var(--fx-surface-raised-hover)" : "var(--fx-surface-raised)",
          textAlign: "start",
          cursor: "pointer",
          transition: "background var(--duration-quick) var(--ease-out)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: 40,
            height: 40,
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-card)",
            background: "var(--fx-surface-card)",
            color: "var(--fx-text-secondary)",
          }}
        >
          <SmartphoneIcon />
        </span>
        <span style={{ display: "grid", gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
            <span className="type-body-large-medium" style={{ color: "var(--fx-text-primary)" }}>
              {title}
            </span>
            {connected > 0 ? (
              <Badge tone="success">
                {t("remoteChatConnectedCount", "{count} conversations connected").replace("{count}", String(connected))}
              </Badge>
            ) : (
              <Badge tone="muted">{t("remoteChatNoConnections", "No conversations connected")}</Badge>
            )}
          </span>
          <span className="type-body-default" style={{ color: "var(--fx-text-secondary)" }}>
            {t(
              "remoteChatEntryDescription",
              "Connect sessions to WeChat, Telegram, or Feishu and keep working from your phone when you're away",
            )}
          </span>
        </span>
        <span
          aria-hidden="true"
          style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", flexShrink: 0 }}
        >
          {shownChannels(snapshot).map((channel) => (
            <ChannelBrandMark key={channel} channel={channel} size={22} />
          ))}
        </span>
        {offline > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span
              aria-hidden="true"
              style={{ width: 6, height: 6, borderRadius: 3, background: "var(--fx-status-warning)" }}
            />
            <span
              className="type-label-default"
              style={{ color: "var(--fx-status-warning-text)", whiteSpace: "nowrap" }}
            >
              {t("remoteChatOfflineCount", "{count} offline").replace("{count}", String(offline))}
            </span>
          </span>
        )}
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
          style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </section>
  );
}

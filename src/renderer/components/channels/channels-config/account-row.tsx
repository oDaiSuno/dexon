import { useState, type MouseEvent } from "react";
import type { ChannelAccountView, ChannelStatus, ChannelsSnapshot } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Badge, Button } from "../../form-controls";
import { ChannelBrandMark } from "../channel-brand-mark";
import { ChevronRightIcon, RefreshIcon } from "./channel-icons";
import {
  accountPresence,
  connectionMethodLabel,
  conversationCount,
  conversationsLabel,
  lastMessageLabel,
} from "./channel-presentation";

export function AccountRow({
  account,
  status,
  snapshot,
  divider,
  busy,
  onOpen,
  onReconnect,
}: {
  account: ChannelAccountView;
  status?: ChannelStatus;
  snapshot: ChannelsSnapshot;
  divider: boolean;
  busy: boolean;
  onOpen: () => void;
  onReconnect: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const presence = accountPresence(status, t);
  const lastMessage = lastMessageLabel(status?.lastInboundAt, Date.now(), t);
  const summary = [conversationsLabel(conversationCount(snapshot, account.id), t), lastMessage]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      data-testid="channel-account-row"
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderTop: divider ? "1px solid var(--fx-line-default)" : undefined,
        background: hovered ? "var(--fx-surface-hover-overlay)" : "var(--fx-surface-hover-clear)",
        cursor: "pointer",
        transition: "background-color var(--duration-quick) var(--ease-smooth-out)",
      }}
    >
      <button
        type="button"
        aria-label={t("channelOpenDetail", "Open {name} settings").replace("{name}", account.name)}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          onOpen();
        }}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: 0,
          border: "none",
          background: "var(--fx-surface-hover-clear)",
          color: "inherit",
          textAlign: "start",
          cursor: "pointer",
        }}
      >
        <ChannelBrandMark channel={account.channel} size={36} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              className="type-body-large-medium"
              style={{
                color: "var(--fx-text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {account.name}
            </span>
            <Badge tone={presence.tone}>{presence.label}</Badge>
          </span>
          <span className="type-body-default" style={{ color: "var(--fx-text-secondary)" }}>
            {connectionMethodLabel(account, t)}
          </span>
        </span>
      </button>
      {presence.offline ? (
        <>
          {status?.lastError && (
            <span
              className="type-label-default"
              style={{ minWidth: 0, color: "var(--fx-status-warning-text)", overflowWrap: "anywhere" }}
            >
              {status.lastError}
            </span>
          )}
          <Button
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onReconnect();
            }}
          >
            <RefreshIcon />
            {t("restart", "Reconnect")}
          </Button>
        </>
      ) : (
        <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)", whiteSpace: "nowrap" }}>
          {summary}
        </span>
      )}
      <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--fx-text-tertiary)" }}>
        <ChevronRightIcon />
      </span>
    </li>
  );
}

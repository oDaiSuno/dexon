import type { ReactNode } from "react";
import type { ChannelAccountView, ChannelBinding } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { KeyHint } from "../chat-input/SendControls";
import { ChannelBrandMark } from "./channel-brand-mark";
import { channelLabel } from "./channels-config/channel-labels";
import type { AccountPresence } from "./channels-config/channel-presentation";
import { ConnectedCard, RemoteBrands, RemoteGlyph, type BindingGroup } from "./quick-channel-rows";

export interface RemoteSearch {
  value: string;
  label: string;
  count: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function RemoteHeader({ onBack, title, search }: { onBack: () => void; title: string; search?: RemoteSearch }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        height: 44,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 14px 0 8px",
        borderBottom: "1px solid var(--fx-line-default)",
      }}
    >
      <button
        type="button"
        aria-label={t("remoteBack", "Back")}
        title={t("remoteBack", "Back")}
        onClick={onBack}
        style={{
          width: 28,
          height: 28,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          border: "none",
          borderRadius: "var(--radius-row)",
          background: "var(--fx-surface-hover-clear)",
          color: "var(--fx-text-secondary)",
          cursor: "pointer",
          transition: "background var(--duration-quick) var(--ease-smooth-out)",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "var(--fx-surface-hover-clear)";
        }}
      >
        <RemoteGlyph name="chevron-left" size={16} strokeWidth={2} />
      </button>
      {search ? (
        <>
          <span aria-hidden style={{ width: 1, height: 16, flexShrink: 0, background: "var(--fx-line-default)" }} />
          <span aria-hidden style={{ display: "flex", flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
            <RemoteGlyph name="search" size={15} strokeWidth={2} />
          </span>
          <input
            autoFocus
            data-remote-search
            value={search.value}
            aria-label={search.label}
            placeholder={search.label}
            onChange={(event) => search.onChange(event.target.value)}
            onKeyDown={search.onKeyDown}
            className="type-body-default placeholder:text-[var(--fx-text-tertiary)]"
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              padding: 0,
              border: "none",
              background: "none",
              color: "var(--fx-text-primary)",
              caretColor: "var(--fx-accent-blue)",
              outline: "none",
            }}
          />
          <span className="type-mono-meta" style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
            {search.count}
          </span>
        </>
      ) : (
        <span className="type-body-medium" style={{ flex: 1, minWidth: 0, color: "var(--fx-text-primary)" }}>
          {title}
        </span>
      )}
    </div>
  );
}

export interface LinkedConversation {
  binding: ChannelBinding;
  account?: ChannelAccountView;
  since: string;
  online: boolean;
}

export function RemoteLinked({
  items,
  busy,
  onDisconnect,
}: {
  items: LinkedConversation[];
  busy: boolean;
  onDisconnect: (binding: ChannelBinding) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 6, padding: "10px 10px 4px" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px", color: "var(--fx-text-tertiary)" }}
      >
        <span className="type-meta-caps">{t("channelBindingIndicatorTitle", "Connected to this session")}</span>
        <span className="type-mono-meta">{items.length}</span>
      </div>
      {items.map((item) => (
        <ConnectedCard
          key={item.binding.id}
          binding={item.binding}
          account={item.account}
          since={item.since}
          online={item.online}
          busy={busy}
          onDisconnect={() => onDisconnect(item.binding)}
        />
      ))}
    </div>
  );
}

export function RemoteList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        maxHeight: 300,
        overflowY: "auto",
        overscrollBehavior: "contain",
        scrollbarWidth: "none",
        display: "flex",
        flexDirection: "column",
        gap: 1,
        padding: 6,
      }}
    >
      {children}
    </div>
  );
}

export function RemoteHint({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 10px 6px",
        color: "var(--fx-text-tertiary)",
      }}
    >
      <span aria-hidden style={{ display: "flex", flexShrink: 0 }}>
        <RemoteGlyph name="info" size={13} />
      </span>
      <span className="type-label-default" style={{ flex: 1, minWidth: 0 }}>
        {children}
      </span>
    </div>
  );
}

export function GroupHeader({
  group,
  presence,
  busy,
  onReconnect,
}: {
  group: BindingGroup;
  presence: AccountPresence;
  busy: boolean;
  onReconnect: () => void;
}) {
  const { t } = useI18n();
  const dot = presence.online
    ? "var(--fx-status-success)"
    : presence.offline
      ? "var(--fx-status-warning)"
      : "var(--fx-text-tertiary)";
  const status = (
    <>
      <span aria-hidden style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 3, background: dot }} />
      <span className="type-meta-default">
        {presence.offline ? t("boundToMessagingChannelsOffline", "Offline · click to reconnect") : presence.label}
      </span>
    </>
  );
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 10px 4px",
        color: "var(--fx-text-tertiary)",
      }}
    >
      <ChannelBrandMark channel={group.channel} size={14} />
      <span className="type-meta-caps" style={{ flexShrink: 0 }}>
        {channelLabel(group.channel, t, group.account?.domain ?? "feishu")}
      </span>
      <span
        className="type-mono-meta"
        style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {group.account?.name || group.accountId}
      </span>
      <span style={{ flex: 1 }} />
      {presence.offline ? (
        <button
          type="button"
          disabled={busy}
          onClick={onReconnect}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: 0,
            border: "none",
            background: "none",
            color: "var(--fx-status-warning)",
            cursor: busy ? "progress" : "pointer",
          }}
        >
          {status}
        </button>
      ) : (
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>{status}</span>
      )}
    </div>
  );
}

export function RemoteEmpty({ onConnect }: { onConnect: () => void }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "28px 16px 24px",
        textAlign: "center",
      }}
    >
      <RemoteBrands size={30} gap={6} />
      <span aria-hidden style={{ width: 1, height: 10 }} />
      <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
        {t("remoteEmptyTitle", "No chat apps connected yet")}
      </span>
      <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
        {t(
          "remoteEmptyDescription",
          "Connect WeChat, Telegram, or Feishu to send and receive this session's messages on your phone.",
        )}
      </span>
      <span aria-hidden style={{ width: 1, height: 8 }} />
      <Button autoFocus onClick={onConnect}>
        <RemoteGlyph name="arrow-up-right" size={14} strokeWidth={2} />
        {t("remoteGoConnect", "Connect an app")}
      </Button>
    </div>
  );
}

export function RemoteFooter({
  hints,
  onManage,
}: {
  hints: { keyLabel: string; label: string }[];
  onManage: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        height: 34,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 14px",
        borderTop: "1px solid var(--fx-line-default)",
        background: "var(--fx-surface-inset)",
      }}
    >
      {hints.map((hint) => (
        <KeyHint key={hint.keyLabel} keyLabel={hint.keyLabel} label={hint.label} />
      ))}
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onManage}
        className="type-label-default"
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: 0,
          border: "none",
          background: "none",
          color: "var(--fx-text-secondary)",
          cursor: "pointer",
        }}
      >
        {t("remoteManage", "Manage remote chat")}
        <span aria-hidden style={{ display: "flex", color: "var(--fx-text-tertiary)" }}>
          <RemoteGlyph name="arrow-up-right" size={12} strokeWidth={2} />
        </span>
      </button>
    </div>
  );
}

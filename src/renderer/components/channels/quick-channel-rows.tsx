import type { ChannelAccountView, ChannelBinding, ChannelId } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { Icon } from "../chat-input/icons";
import { KeyHint } from "../chat-input/SendControls";
import { ChannelBrandMark, type ChannelBrandMarkSize } from "./channel-brand-mark";
import { channelLabel } from "./channels-config/channel-labels";
import { initialOf } from "./channels-config/channel-presentation";

const GLYPHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  "chevron-left": <path d="m15 18-6-6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  "arrow-up-right": (
    <>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  link: (
    <>
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" x2="16" y1="12" y2="12" />
    </>
  ),
  unlink: (
    <>
      <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
      <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
      <line x1="8" x2="8" y1="2" y2="5" />
      <line x1="2" x2="5" y1="8" y2="8" />
      <line x1="16" x2="16" y1="19" y2="22" />
      <line x1="19" x2="22" y1="16" y2="16" />
    </>
  ),
  smartphone: (
    <>
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </>
  ),
} as const;

export interface BindingGroup {
  accountId: string;
  account?: ChannelAccountView;
  channel: ChannelId;
  bindings: ChannelBinding[];
}

export type RemoteGlyphName = keyof typeof GLYPHS;

export function RemoteGlyph({
  name,
  size,
  strokeWidth = 1.75,
}: {
  name: RemoteGlyphName;
  size: number;
  strokeWidth?: number;
}) {
  return (
    <Icon size={size} strokeWidth={strokeWidth}>
      {GLYPHS[name]}
    </Icon>
  );
}

const BRAND_ORDER: ChannelId[] = ["weixin", "telegram", "feishu"];

export function RemoteBrands({ size, gap }: { size: ChannelBrandMarkSize; gap: number }) {
  return (
    <span aria-hidden style={{ flexShrink: 0, display: "flex", alignItems: "center", gap }}>
      {BRAND_ORDER.map((channel) => (
        <ChannelBrandMark key={channel} channel={channel} size={size} />
      ))}
    </span>
  );
}

const CHANNEL_TONE: Record<ChannelId, { soft: string; line: string; ink: string }> = {
  weixin: {
    soft: "var(--fx-channel-wechat-soft)",
    line: "var(--fx-channel-wechat-line)",
    ink: "var(--fx-channel-wechat-ink)",
  },
  telegram: {
    soft: "var(--fx-channel-telegram-soft)",
    line: "var(--fx-channel-telegram-line)",
    ink: "var(--fx-channel-telegram-ink)",
  },
  feishu: {
    soft: "var(--fx-channel-feishu-soft)",
    line: "var(--fx-channel-feishu-line)",
    ink: "var(--fx-channel-feishu-ink)",
  },
};

function PeerAvatar({ binding }: { binding: ChannelBinding }) {
  const group = binding.peerKind === "group";
  return (
    <span
      aria-hidden
      className="type-meta-caps"
      style={{
        width: 24,
        height: 24,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        border: "1px solid var(--fx-line-default)",
        borderRadius: group ? "var(--radius-row)" : 12,
        background: "var(--fx-surface-card)",
        color: "var(--fx-text-secondary)",
      }}
    >
      {group ? <RemoteGlyph name="users" size={13} /> : initialOf(binding.peerId)}
    </span>
  );
}

export function peerKindLabel(
  binding: ChannelBinding,
  account: ChannelAccountView | undefined,
  t: (key: string, fallback: string) => string,
): string {
  if (binding.peerKind !== "group") return t("directConversation", "DM");
  return account?.requireMention && !binding.sessionId
    ? t("remoteGroupMention", "Group · replies only when the bot is @mentioned")
    : t("groupConversation", "Group");
}

export function BindingRow({
  binding,
  account,
  sessionId,
  elsewhereTitle,
  active,
  dimmed,
  busy,
  onHover,
  onConnect,
}: {
  binding: ChannelBinding;
  account?: ChannelAccountView;
  sessionId: string;
  elsewhereTitle: string | null;
  active: boolean;
  dimmed: boolean;
  busy: boolean;
  onHover: () => void;
  onConnect: () => void;
}) {
  const { t } = useI18n();
  const here = binding.sessionId === sessionId;
  const elsewhere = Boolean(binding.sessionId) && !here;
  let trailing = null;
  if (here) {
    trailing = (
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
        <span aria-hidden style={{ display: "flex", color: "var(--fx-status-success)" }}>
          <RemoteGlyph name="check" size={13} strokeWidth={2} />
        </span>
        <span className="type-label-default" style={{ color: "var(--fx-text-secondary)" }}>
          {t("boundToCurrentSession", "Connected here")}
        </span>
      </span>
    );
  } else if (elsewhere) {
    trailing = (
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, color: "var(--fx-text-tertiary)" }}>
        <span aria-hidden style={{ display: "flex" }}>
          <RemoteGlyph name="link" size={12} strokeWidth={2} />
        </span>
        <span className="type-label-default">
          {t("boundToAnotherSession", "Connected to “{title}”").replace(
            "{title}",
            elsewhereTitle ?? binding.sessionId ?? "",
          )}
        </span>
      </span>
    );
  } else if (active) {
    trailing = <KeyHint keyLabel="↵" label={t("bindHere", "Connect")} />;
  }
  return (
    <button
      type="button"
      aria-current={here ? "true" : undefined}
      title={elsewhere ? t("rebindHere", "Move this conversation to this session") : undefined}
      disabled={busy || here}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onConnect}
      onMouseEnter={onHover}
      style={{
        width: "100%",
        height: 40,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 10px",
        border: "none",
        borderRadius: "var(--radius-control)",
        background: active ? "var(--fx-surface-hover-overlay)" : "var(--fx-surface-hover-clear)",
        opacity: dimmed ? 0.55 : 1,
        color: "var(--fx-text-primary)",
        cursor: here ? "default" : busy ? "progress" : "pointer",
        textAlign: "left",
        transition: "background var(--duration-quick) var(--ease-smooth-out)",
      }}
    >
      <PeerAvatar binding={binding} />
      <span
        className="type-body-default"
        title={binding.peerId}
        style={{ flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {binding.peerId}
      </span>
      <span
        className="type-label-default"
        style={{
          flex: 1,
          minWidth: 0,
          color: "var(--fx-text-tertiary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {peerKindLabel(binding, account, t)}
      </span>
      {trailing}
    </button>
  );
}

export function ConnectedCard({
  binding,
  account,
  since,
  online,
  busy,
  onDisconnect,
}: {
  binding: ChannelBinding;
  account?: ChannelAccountView;
  since: string;
  online: boolean;
  busy: boolean;
  onDisconnect: () => void;
}) {
  const { t } = useI18n();
  const tone = CHANNEL_TONE[binding.channel];
  const channel = channelLabel(binding.channel, t, account?.domain ?? "feishu");
  const kind = binding.peerKind === "group" ? t("groupConversation", "Group") : t("directConversation", "DM");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 10px 10px 12px",
        border: `1px solid ${tone.line}`,
        borderRadius: "var(--radius-card)",
        background: tone.soft,
      }}
    >
      <span
        aria-hidden
        className="type-body-medium"
        style={{
          width: 32,
          height: 32,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          border: `1px solid ${tone.line}`,
          borderRadius: 16,
          background: "var(--fx-surface-raised)",
          color: tone.ink,
        }}
      >
        {binding.peerKind === "group" ? <RemoteGlyph name="users" size={15} /> : initialOf(binding.peerId)}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            className="type-body-medium"
            title={binding.peerId}
            style={{
              minWidth: 0,
              color: "var(--fx-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {binding.peerId}
          </span>
          <ChannelBrandMark channel={binding.channel} size={14} />
          <span className="type-label-default" style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
            {`${channel} · ${kind}`}
          </span>
        </span>
        <span
          className="type-label-default"
          style={{
            color: "var(--fx-text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {t(
            "remoteLinkedHint",
            "Messages they send on {channel} show up here, and your replies go back to them",
          ).replace("{channel}", channel)}
        </span>
      </span>
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: online ? "var(--fx-status-success)" : "var(--fx-status-warning)",
          }}
        />
        <span className="type-mono-meta" style={{ color: "var(--fx-text-tertiary)" }}>
          {since}
        </span>
      </span>
      <Button disabled={busy} onClick={onDisconnect}>
        <RemoteGlyph name="unlink" size={14} strokeWidth={2} />
        {t("unbind", "Disconnect")}
      </Button>
    </div>
  );
}

export function RemoteMenuStatus({
  linked,
  account,
  online,
}: {
  linked: ChannelBinding[];
  account?: ChannelAccountView;
  online: boolean;
}) {
  const { t } = useI18n();
  if (linked.length === 0) {
    return (
      <span
        className="type-label-default"
        style={{
          minWidth: 0,
          flex: 1,
          color: "var(--fx-text-tertiary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {t(
          "remoteChatMenuDescription",
          "Connect this session to WeChat, Telegram, or Feishu and keep going away from your desk",
        )}
      </span>
    );
  }
  const [first] = linked;
  return (
    <span style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          flexShrink: 0,
          borderRadius: 3,
          background: online ? "var(--fx-status-success)" : "var(--fx-status-warning)",
        }}
      />
      <span
        className="type-label-default"
        style={{
          minWidth: 0,
          color: "var(--fx-text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {`${t("connectedToChannel", "Connected to")} ${channelLabel(first.channel, t, account?.domain ?? "feishu")} · ${first.peerId}`}
      </span>
      {linked.length > 1 && (
        <span className="type-mono-meta" style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
          {`+${linked.length - 1}`}
        </span>
      )}
    </span>
  );
}

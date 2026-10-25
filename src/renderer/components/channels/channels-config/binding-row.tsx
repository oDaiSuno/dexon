import type { ReactNode } from "react";
import type { ChannelBinding, ChannelsSnapshot } from "@shared/channel-types";
import type { SessionInfo } from "@contract/types";
import { useI18n } from "@/i18n";
import { ChannelBrandMark } from "../channel-brand-mark";
import { BindingMenu } from "./binding-menu";
import { bindingTimeLabel, projectName, sessionTitle } from "./binding-presentation";
import { ArrowLeftRightIcon, MessageSquareDashedIcon, MessageSquareIcon, UsersIcon } from "./channel-icons";
import { channelLabel } from "./channel-labels";
import { initialOf } from "./channel-presentation";

const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

function Avatar({ group, name }: { group: boolean; name: string }) {
  return (
    <span
      aria-hidden="true"
      className="type-body-medium"
      style={{
        width: 32,
        height: 32,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--fx-line-default)",
        borderRadius: group ? "var(--radius-control)" : "var(--radius-pill)",
        background: "var(--fx-surface-card)",
        color: "var(--fx-text-secondary)",
      }}
    >
      {group ? <UsersIcon /> : initialOf(name)}
    </span>
  );
}

function Stack({ gap, children }: { gap: number; children: ReactNode }) {
  return <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap }}>{children}</span>;
}

export function BindingRow({
  binding,
  snapshot,
  session,
  sessions,
  currentSessionId,
  divider,
  busy,
  onAttach,
  onDisconnect,
}: {
  binding: ChannelBinding;
  snapshot: ChannelsSnapshot;
  session?: SessionInfo;
  sessions: SessionInfo[];
  currentSessionId?: string | null;
  divider: boolean;
  busy: boolean;
  onAttach: (sessionId: string | undefined) => void;
  onDisconnect: () => void;
}) {
  const { language, t } = useI18n();
  const group = binding.peerKind === "group";
  const domain = snapshot.accounts.find((account) => account.id === binding.accountId)?.domain;
  const kind = group ? t("groupConversation", "Group") : t("directConversation", "DM");
  const source = [channelLabel(binding.channel, t, domain), kind].join(" · ");
  const name = binding.threadId ? `${binding.peerId} · ${t("topic", "topic")} ${binding.threadId}` : binding.peerId;
  const attachedId = binding.sessionId;
  const live = Boolean(attachedId && attachedId === currentSessionId);

  return (
    <li
      data-testid="channel-binding-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 16px",
        borderTop: divider ? "1px solid var(--fx-line-default)" : undefined,
      }}
    >
      <span style={{ width: 220, flexShrink: 0, display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <Avatar group={group} name={binding.peerId} />
        <Stack gap={3}>
          <span className="type-body-medium" style={{ color: "var(--fx-text-primary)", ...ellipsis }} title={name}>
            {name}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <ChannelBrandMark channel={binding.channel} size={14} />
            <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)", ...ellipsis }}>
              {source}
            </span>
          </span>
        </Stack>
      </span>
      <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--fx-text-faint)" }}>
        <ArrowLeftRightIcon />
      </span>
      <Stack gap={3}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              color: attachedId ? "var(--fx-text-secondary)" : "var(--fx-text-tertiary)",
            }}
          >
            {attachedId ? <MessageSquareIcon /> : <MessageSquareDashedIcon />}
          </span>
          <span
            className="type-body-medium"
            style={{ color: attachedId ? "var(--fx-text-primary)" : "var(--fx-text-secondary)", ...ellipsis }}
          >
            {attachedId ? (session ? sessionTitle(session) : attachedId) : t("dedicatedImSession", "Separate session")}
          </span>
          {live && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
              <span
                aria-hidden="true"
                style={{ width: 6, height: 6, borderRadius: 3, background: "var(--fx-status-success)" }}
              />
              <span className="type-label-default" style={{ color: "var(--fx-status-success)" }}>
                {t("currentSessionMarker", "Current session")}
              </span>
            </span>
          )}
        </span>
        {attachedId ? (
          <span
            className="type-mono-meta"
            style={{ color: "var(--fx-text-tertiary)", ...ellipsis }}
            title={binding.cwd}
          >
            {projectName(binding.cwd)}
          </span>
        ) : (
          <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)", ...ellipsis }}>
            {t(
              "dedicatedImSessionDescription",
              "Not connected to a desktop session; chat messages are kept separately",
            )}
          </span>
        )}
      </Stack>
      <span
        className="type-mono-meta"
        style={{ flexShrink: 0, color: "var(--fx-text-tertiary)", whiteSpace: "nowrap" }}
        title={new Date(binding.lastUsedAt).toLocaleString(language)}
      >
        {bindingTimeLabel(binding.lastUsedAt, Date.now(), language, t)}
      </span>
      <BindingMenu
        label={t("bindingMoreActions", "More actions for {name}").replace("{name}", name)}
        name={name}
        sessionId={binding.sessionId}
        sessions={sessions}
        busy={busy}
        onAttach={onAttach}
        onDisconnect={onDisconnect}
      />
    </li>
  );
}

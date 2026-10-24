import { Fragment, useEffect, useMemo, useState } from "react";
import type { ChannelBinding, ChannelsSnapshot } from "@shared/channel-types";
import { call, listSessions } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { formatRelativeDateTime } from "@/lib/locale-format";
import { getSessionDisplayTitle } from "@/lib/session-list";
import { MenuPanel } from "../chat-input/menu-chrome";
import { channelLabel, statusFor } from "./channels-config/channel-labels";
import { accountPresence } from "./channels-config/channel-presentation";
import { BindingRow, type BindingGroup } from "./quick-channel-rows";
import {
  GroupHeader,
  RemoteEmpty,
  RemoteFooter,
  RemoteHeader,
  RemoteHint,
  RemoteLinked,
  RemoteList,
  type LinkedConversation,
} from "./quick-channel-chrome";

interface QuickChannelBindingProps {
  sessionId: string;
  snapshot: ChannelsSnapshot;
  onSnapshotChange: (snapshot: ChannelsSnapshot) => void;
  onBack: () => void;
  onManage: () => void;
}

type Translate = (key: string, fallback: string) => string;

function hasRemoteAccounts(snapshot: ChannelsSnapshot): boolean {
  return snapshot.accounts.some((account) => account.configured) || snapshot.bindings.length > 0;
}

function countLabel(t: Translate, linked: number, total: number): string {
  if (linked > 0) {
    return t("connectedToMessagingChannels", "{linked} connected · {total} total")
      .replace("{linked}", String(linked))
      .replace("{total}", String(total));
  }
  if (total === 1) return t("remoteOneConversation", "1 conversation");
  return t("remoteConversationCount", "{count} conversations").replace("{count}", String(total));
}

export function QuickChannelBinding({
  sessionId,
  snapshot,
  onSnapshotChange,
  onBack,
  onManage,
}: QuickChannelBindingProps) {
  const { language, t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sessionTitles, setSessionTitles] = useState<ReadonlyMap<string, string>>(new Map());

  const available = hasRemoteAccounts(snapshot);
  const elsewhereIds = snapshot.bindings.some((binding) => binding.sessionId && binding.sessionId !== sessionId);

  useEffect(() => {
    if (!elsewhereIds) return;
    let cancelled = false;
    listSessions()
      .then(({ sessions }) => {
        if (cancelled) return;
        setSessionTitles(new Map(sessions.map((session) => [session.id, getSessionDisplayTitle(session, 40)])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [elsewhereIds]);

  const accountOf = (accountId: string) => snapshot.accounts.find((account) => account.id === accountId);
  const isOnline = (accountId: string) => accountPresence(statusFor(snapshot, accountId), t).online;
  const linked = snapshot.bindings.filter((binding) => binding.sessionId === sessionId);
  const needle = query.trim().toLowerCase();

  const groups = useMemo<BindingGroup[]>(() => {
    const result: BindingGroup[] = snapshot.accounts
      .filter((account) => account.configured || snapshot.bindings.some((binding) => binding.accountId === account.id))
      .map((account) => ({ accountId: account.id, account, channel: account.channel, bindings: [] }));
    for (const binding of snapshot.bindings) {
      let group = result.find((candidate) => candidate.accountId === binding.accountId);
      if (!group) {
        group = { accountId: binding.accountId, channel: binding.channel, bindings: [] };
        result.push(group);
      }
      const haystack = `${binding.peerId} ${group.account?.name ?? ""} ${channelLabel(binding.channel, t)}`;
      if (!needle || haystack.toLowerCase().includes(needle)) group.bindings.push(binding);
    }
    return needle ? result.filter((group) => group.bindings.length > 0) : result;
  }, [needle, snapshot.accounts, snapshot.bindings, t]);
  const rows = groups.flatMap((group) => group.bindings);
  const active = Math.min(activeIndex, Math.max(0, rows.length - 1));
  const linkedItems: LinkedConversation[] = linked.map((binding) => ({
    binding,
    account: accountOf(binding.accountId),
    since: formatRelativeDateTime(binding.lastUsedAt, language),
    online: isOnline(binding.accountId),
  }));

  const run = async (id: string, task: () => Promise<ChannelsSnapshot | void>) => {
    setBusyId(id);
    setError("");
    try {
      const next = await task();
      if (next) onSnapshotChange(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };
  const updateBinding = (binding: ChannelBinding, bind: boolean) =>
    run(binding.id, () =>
      call("channels.bindingUpsert", {
        binding: { ...binding, sessionId: bind ? sessionId : undefined, lastUsedAt: new Date().toISOString() },
      }),
    );
  const reconnect = (accountId: string) =>
    run(accountId, async () => {
      await call("channels.restart", { accountId });
    });

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(active + 1, Math.max(0, rows.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(0, active - 1));
      return;
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const target = rows[active];
      if (target && target.sessionId !== sessionId && busyId === null) void updateBinding(target, true);
    }
  };

  return (
    <MenuPanel label={t("bindChannelToCurrentSession", "Connect a chat conversation to this session")}>
      <div
        data-testid="channel-quick-bind-popover"
        style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onBack();
        }}
      >
        <RemoteHeader
          onBack={onBack}
          title={t("channels", "Remote chat")}
          search={
            available
              ? {
                  value: query,
                  label: t("quickChannelBindingDescription", "Search contacts or groups…"),
                  count: countLabel(t, linked.length, snapshot.bindings.length),
                  onChange: (next) => {
                    setQuery(next);
                    setActiveIndex(0);
                  },
                  onKeyDown: onSearchKey,
                }
              : undefined
          }
        />
        {error && (
          <div
            role="alert"
            className="type-label-default"
            style={{ padding: "8px 14px 0", color: "var(--fx-status-danger-text)", overflowWrap: "anywhere" }}
          >
            {error}
          </div>
        )}
        {available ? (
          <>
            {linked.length > 0 && !needle && (
              <RemoteLinked
                items={linkedItems}
                busy={busyId !== null}
                onDisconnect={(binding) => void updateBinding(binding, false)}
              />
            )}
            <RemoteList label={t("quickChannelBinding", "Conversations you can connect")}>
              {groups.map((group) => {
                const presence = accountPresence(statusFor(snapshot, group.accountId), t);
                return (
                  <Fragment key={group.accountId}>
                    <GroupHeader
                      group={group}
                      presence={presence}
                      busy={busyId !== null}
                      onReconnect={() => void reconnect(group.accountId)}
                    />
                    {group.bindings.map((binding) => {
                      const index = rows.indexOf(binding);
                      return (
                        <BindingRow
                          key={binding.id}
                          binding={binding}
                          account={group.account}
                          sessionId={sessionId}
                          elsewhereTitle={binding.sessionId ? (sessionTitles.get(binding.sessionId) ?? null) : null}
                          active={index === active}
                          dimmed={presence.offline && !binding.sessionId}
                          busy={busyId !== null}
                          onHover={() => setActiveIndex(index)}
                          onConnect={() => void updateBinding(binding, true)}
                        />
                      );
                    })}
                  </Fragment>
                );
              })}
              <RemoteHint>
                {t(
                  "noBindableChannelConversations",
                  "Don't see the conversation you want? Send the bot a message from your phone and it will show up here.",
                )}
              </RemoteHint>
            </RemoteList>
          </>
        ) : (
          <RemoteEmpty onConnect={onManage} />
        )}
        <RemoteFooter
          hints={
            available
              ? [
                  { keyLabel: "↑↓", label: t("menuKeySelect", "Select") },
                  { keyLabel: "↵", label: t("bindMessagingConversation", "Connect to this session") },
                  { keyLabel: "esc", label: t("remoteBack", "Back") },
                ]
              : [{ keyLabel: "esc", label: t("remoteBack", "Back") }]
          }
          onManage={onManage}
        />
      </div>
    </MenuPanel>
  );
}

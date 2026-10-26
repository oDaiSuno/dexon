import type { ReactNode } from "react";
import type { ChannelActivity, ChannelsSnapshot } from "@shared/channel-types";
import { useI18n, type AppLanguage } from "@/i18n";
import { ChannelBrandMark } from "../channel-brand-mark";
import { ArrowDownLeftIcon, ArrowUpRightIcon, BanIcon, TriangleAlertIcon } from "./channel-icons";
import { activityDirectionLabel, activityOutcomeLabel, type Translate } from "./channel-labels";

function activitySentence(activity: ChannelActivity, name: string, t: Translate): string {
  const fill = (text: string) => text.replace("{name}", name);
  if (activity.direction === "system") {
    return activity.outcome === "failed"
      ? fill(t("channelActivityDisconnected", "{name} disconnected"))
      : fill(t("channelActivitySystem", "{name} status changed"));
  }
  if (activity.direction === "outbound") {
    return activity.outcome === "failed"
      ? fill(t("channelActivityReplyFailed", "Couldn't reply to {name}"))
      : fill(t("channelActivityReplied", "Replied to {name}"));
  }
  if (activity.outcome === "ignored") return fill(t("channelActivityIgnored", "Ignored a message from {name}"));
  if (activity.outcome === "failed") {
    return fill(t("channelActivityInboundFailed", "Couldn't handle a message from {name}"));
  }
  return fill(t("channelActivityReceived", "Message from {name}"));
}

function activityIcon(activity: ChannelActivity): { icon: ReactNode; color: string } {
  if (activity.outcome === "failed") return { icon: <TriangleAlertIcon />, color: "var(--fx-status-warning)" };
  if (activity.outcome === "ignored") return { icon: <BanIcon />, color: "var(--fx-text-tertiary)" };
  if (activity.direction === "outbound") return { icon: <ArrowUpRightIcon />, color: "var(--fx-text-secondary)" };
  return { icon: <ArrowDownLeftIcon />, color: "var(--fx-text-secondary)" };
}

function activityTime(at: string, now: number, language: AppLanguage): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(language, {
    ...(sameDay ? {} : { month: "numeric", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function ActivityRow({ activity, snapshot }: { activity: ChannelActivity; snapshot: ChannelsSnapshot }) {
  const { language, t } = useI18n();
  const account = snapshot.accounts.find((candidate) => candidate.id === activity.accountId);
  const name = (activity.direction === "system" ? account?.name : activity.peerId) ?? account?.name ?? "";
  const { icon, color } = activityIcon(activity);
  const kind = `${activityDirectionLabel(activity.direction, t)} · ${activityOutcomeLabel(activity.outcome, t)}`;

  return (
    <li
      data-testid="channel-activity-entry"
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 16px", minWidth: 0 }}
    >
      <time
        dateTime={activity.at}
        title={new Date(activity.at).toLocaleString(language)}
        className="type-mono-meta"
        style={{ flexShrink: 0, color: "var(--fx-text-tertiary)", whiteSpace: "nowrap" }}
      >
        {activityTime(activity.at, Date.now(), language)}
      </time>
      <span role="img" aria-label={kind} title={kind} style={{ display: "inline-flex", flexShrink: 0, color }}>
        {icon}
      </span>
      <ChannelBrandMark channel={activity.channel} size={14} />
      <span
        className="type-label-medium"
        style={{
          flexShrink: 0,
          maxWidth: "50%",
          color: "var(--fx-text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {activitySentence(activity, name, t)}
      </span>
      {activity.detail && (
        <span
          className="type-label-default"
          title={activity.detail}
          style={{
            flex: 1,
            minWidth: 0,
            color: "var(--fx-text-tertiary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {activity.detail}
        </span>
      )}
    </li>
  );
}

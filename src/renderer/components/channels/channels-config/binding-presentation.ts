import type { ChannelBinding } from "@shared/channel-types";
import type { SessionInfo } from "@contract/types";
import type { AppLanguage } from "@/i18n";
import { formatShortRelativeTime } from "@/lib/locale-format";
import type { Translate } from "./channel-labels";

export function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id;
}

export function projectName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function calendarDaysBetween(earlier: Date, later: Date): number {
  const start = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate()).getTime();
  const end = new Date(later.getFullYear(), later.getMonth(), later.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function bindingTimeLabel(at: string, now: number, language: AppLanguage, t: Translate): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const elapsedDays = calendarDaysBetween(date, new Date(now));
  if (now - date.getTime() >= 86_400_000 && elapsedDays >= 2 && elapsedDays < 7) {
    return t("channelBindingDaysAgo", "{count} d").replace("{count}", String(elapsedDays));
  }
  return formatShortRelativeTime(date, language, now);
}

export function bindingMatches(binding: ChannelBinding, session: SessionInfo | undefined, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [binding.peerId, binding.threadId, session && sessionTitle(session), projectName(binding.cwd)]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

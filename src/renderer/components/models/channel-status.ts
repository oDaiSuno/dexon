import { useI18n } from "@/i18n";
import type { ProviderChannelState, ProviderChannelTestResult } from "@contract/types";
import type { ProviderRowTone } from "./provider-tree";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function useChannelStatus() {
  const { t } = useI18n();

  const ago = (testedAt: string): string => {
    const elapsed = Math.max(0, Date.now() - Date.parse(testedAt));
    if (elapsed < MINUTE_MS) return t("modelTestedJustNow", "just now");
    if (elapsed < HOUR_MS) {
      return t("modelTestedMinutesAgo", "{count} min ago").replace("{count}", String(Math.floor(elapsed / MINUTE_MS)));
    }
    if (elapsed < DAY_MS) {
      return t("modelTestedHoursAgo", "{count} h ago").replace("{count}", String(Math.floor(elapsed / HOUR_MS)));
    }
    return t("modelTestedDaysAgo", "{count} d ago").replace("{count}", String(Math.floor(elapsed / DAY_MS)));
  };

  const status = (channel: ProviderChannelState | undefined): { tone: ProviderRowTone; label: string } => {
    if (channel?.enabled === false) return { tone: "muted", label: t("modelChannelDisabled", "Disabled") };
    const lastTest = channel?.lastTest;
    if (lastTest?.ok === false && lastTest.reason === "timeout") {
      return { tone: "warning", label: t("modelChannelTimedOut", "Timed out") };
    }
    if (lastTest?.ok === false) return { tone: "warning", label: t("modelChannelFailed", "Connection failed") };
    return { tone: "success", label: t("configured", "Active") };
  };

  const testSummary = (lastTest: ProviderChannelTestResult | null | undefined): string | null => {
    if (!lastTest) return null;
    const when = ago(lastTest.testedAt);
    if (lastTest.ok) {
      return [t("modelChannelConnectionOk", "Connection OK"), `${lastTest.latencyMs} ms`, when].join(" · ");
    }
    if (lastTest.reason === "timeout") return [t("modelChannelTimedOut", "Timed out"), when].join(" · ");
    return [t("modelChannelFailed", "Connection failed"), lastTest.error, when].join(" · ");
  };

  return { status, testSummary };
}

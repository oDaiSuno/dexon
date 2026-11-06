import { useI18n } from "@/i18n";
import type { ConnectionPresentation } from "./connection-presentation";

export function useConnectionLabel(presentation: ConnectionPresentation): string {
  const { t } = useI18n();
  switch (presentation.status.kind) {
    case "available":
      return t("serversStatusAvailable", "Available");
    case "connected":
      return t("serversStatusConnected", "Online");
    case "connecting":
      return t("serversStatusConnecting", "Connecting");
    case "backoff":
      return t("serversStatusBackoff", "Reconnecting");
    case "offline":
      return t("serversStatusOffline", "Offline");
    case "blocked":
      return t("serversStatusBlocked", "Needs attention");
  }
}

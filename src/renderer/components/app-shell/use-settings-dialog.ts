import { useCallback, useEffect, useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import type { SettingsTab } from "../SettingsConfig";
import { subscribeSettingsRequest } from "@/lib/settings-request";

export function useSettingsDialog() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("general");
  const [settingsEnvironmentId, setSettingsEnvironmentId] = useState<EnvironmentId | null>(null);
  const [settingsNavigationRequestId, setSettingsNavigationRequestId] = useState(0);

  const openSettings = useCallback((tab: SettingsTab = "general", environmentId?: EnvironmentId | null) => {
    setSettingsInitialTab(tab);
    setSettingsEnvironmentId(environmentId ?? null);
    setSettingsNavigationRequestId((id) => id + 1);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsInitialTab("general");
    setSettingsEnvironmentId(null);
  }, []);

  useEffect(
    () => subscribeSettingsRequest((request) => openSettings(request.tab, request.environmentId)),
    [openSettings],
  );

  useEffect(() => {
    const offSettings = window.piBridge?.onMenu?.("settings", () => openSettings("general"));
    const offCheckForUpdates = window.piBridge?.onMenu?.("check-for-updates", () => {
      openSettings("about");
      void window.piBridge.checkForUpdates().catch(() => undefined);
    });
    const offShowUpdate = window.piBridge?.onMenu?.("show-update", () => openSettings("about"));
    return () => {
      offSettings?.();
      offCheckForUpdates?.();
      offShowUpdate?.();
    };
  }, [openSettings]);

  return {
    settingsOpen,
    settingsInitialTab,
    settingsEnvironmentId,
    settingsNavigationRequestId,
    openSettings,
    closeSettings,
  };
}

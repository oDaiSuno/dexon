import { useCallback, useEffect, useState } from "react";
import type { SettingsTab } from "../SettingsConfig";

export function useSettingsDialog() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("general");
  const [settingsNavigationRequestId, setSettingsNavigationRequestId] = useState(0);

  const openSettings = useCallback((tab: SettingsTab = "general") => {
    setSettingsInitialTab(tab);
    setSettingsNavigationRequestId((id) => id + 1);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsInitialTab("general");
  }, []);

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

  return { settingsOpen, settingsInitialTab, settingsNavigationRequestId, openSettings, closeSettings };
}

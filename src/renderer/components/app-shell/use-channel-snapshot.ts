import { useCallback, useEffect, useState } from "react";
import { call, subscribe } from "@/lib/api-client";
import type { ChannelsSnapshot } from "@shared/channel-types";

// Split from AppShell.tsx in Phase 2: the channel binding snapshot owner.

const EMPTY_CHANNELS: ChannelsSnapshot = { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };

export function useChannelSnapshot() {
  const [channelSnapshot, setChannelSnapshot] = useState<ChannelsSnapshot>(EMPTY_CHANNELS);

  const refreshChannelSnapshot = useCallback(async () => {
    try {
      setChannelSnapshot(await call("channels.list"));
    } catch {
      // Channels are optional; the rest of the desktop remains usable if Host is still starting.
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const unsubs: Array<() => void> = [];
    void refreshChannelSnapshot();
    void Promise.all([
      subscribe("channels.binding", "*", () => void refreshChannelSnapshot()),
      subscribe("channels.status", "*", () => void refreshChannelSnapshot()),
    ])
      .then((items) => {
        if (disposed) items.forEach((unsubscribe) => unsubscribe());
        else unsubs.push(...items);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [refreshChannelSnapshot]);

  return {
    channelSnapshot,
    setChannelSnapshot,
    refreshChannelSnapshot,
  };
}

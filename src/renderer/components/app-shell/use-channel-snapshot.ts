import { useCallback, useEffect, useState } from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import type { ChannelsSnapshot } from "@shared/channel-types";

// Split from AppShell.tsx in Phase 2: the channel binding snapshot owner.

const EMPTY_CHANNELS: ChannelsSnapshot = { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };

export function useChannelSnapshot() {
  const [channelSnapshot, setChannelSnapshot] = useState<ChannelsSnapshot>(EMPTY_CHANNELS);

  const refreshChannelSnapshot = useCallback(async () => {
    try {
      setChannelSnapshot(await getEnvironmentApiClient(PRIMARY_ENVIRONMENT_ID).call("channels.list"));
    } catch {
      // Channels are optional; the rest of the desktop remains usable if Host is still starting.
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const unsubs: Array<() => void> = [];
    void refreshChannelSnapshot();
    void Promise.all([
      getEnvironmentApiClient(PRIMARY_ENVIRONMENT_ID).subscribe(
        "channels.binding",
        "*",
        () => void refreshChannelSnapshot(),
      ),
      getEnvironmentApiClient(PRIMARY_ENVIRONMENT_ID).subscribe(
        "channels.status",
        "*",
        () => void refreshChannelSnapshot(),
      ),
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

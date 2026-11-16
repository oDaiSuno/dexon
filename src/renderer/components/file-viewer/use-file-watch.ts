import type { EnvironmentId } from "@contract/environment";
import { useEffect, useState } from "react";
import { subscribeFileWatch } from "@/lib/file-watch-subscription";

export function useFileWatch(
  environmentId: EnvironmentId,
  filePath: string,
  sourceSessionId: string | null | undefined,
  onChange: (size?: number) => void,
) {
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    setWatching(false);
    return subscribeFileWatch({
      environmentId,
      path: filePath,
      sourceSessionId: sourceSessionId ?? undefined,
      onOpen: () => setWatching(true),
      onGap: () => onChange(),
      onEvent: (event) => {
        if (event.event === "connected") setWatching(true);
        if (event.event === "change") onChange(event.size);
      },
      onError: () => setWatching(false),
    });
  }, [environmentId, filePath, sourceSessionId, onChange]);
  return watching;
}

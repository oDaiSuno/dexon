import { useEffect, useState } from "react";
import { getFileApiUrl } from "./file-api-url";

export function useFileWatch(
  filePath: string,
  sourceSessionId: string | null | undefined,
  onChange: (size?: number) => void,
) {
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    setWatching(false);
    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        onChange(typeof d.size === "number" ? d.size : undefined);
      } catch {
        onChange();
      }
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);
    return () => es.close();
  }, [filePath, sourceSessionId, onChange]);
  return watching;
}

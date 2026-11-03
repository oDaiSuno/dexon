import { useEffect, useState } from "react";
import { getFileApiUrl } from "./file-api-url";
import { useFileWorkspaceFacts } from "../app-shell/remote-workspaces-context";

export function useFileWatch(
  filePath: string,
  sourceSessionId: string | null | undefined,
  onChange: (size?: number) => void,
  cwd?: string,
) {
  const [watching, setWatching] = useState(false);
  const facts = useFileWorkspaceFacts(filePath, cwd);
  const connected = facts.kind !== "ssh" || facts.connection === "connected";
  useEffect(() => {
    setWatching(false);
    if (!connected) return;
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
  }, [filePath, sourceSessionId, onChange, connected]);
  return watching && connected;
}

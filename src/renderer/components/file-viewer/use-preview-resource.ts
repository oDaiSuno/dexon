import { useEffect, useRef, useState } from "react";
import type { FilePreviewResource } from "@/lib/file-blob";
import { useFileWorkspaceFacts } from "../app-shell/remote-workspaces-context";

export function usePreviewResource(
  filePath: string,
  sourceSessionId: string | null | undefined,
  cwd: string | undefined,
  bust: number,
  load: () => Promise<FilePreviewResource>,
) {
  const facts = useFileWorkspaceFacts(filePath, cwd);
  const connected = facts.kind !== "ssh" || facts.connection === "connected";
  const remotePath = facts.kind === "ssh";
  const [resource, setResource] = useState<FilePreviewResource | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentRef = useRef<{ key: string; resource: FilePreviewResource } | null>(null);
  const key = JSON.stringify([filePath, sourceSessionId]);

  useEffect(
    () => () => {
      currentRef.current?.resource.revoke();
      currentRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const current = currentRef.current;
    const retainSnapshot =
      current?.key === key &&
      current.resource.space !== "local-overlay" &&
      (remotePath || current.resource.space === "remote");
    setError(null);
    if (!retainSnapshot) {
      current?.resource.revoke();
      currentRef.current = null;
      setResource(null);
      setSize(null);
    }
    if (!connected && retainSnapshot) return;
    void load()
      .then((next) => {
        if (cancelled) {
          next.revoke();
          return;
        }
        currentRef.current?.resource.revoke();
        currentRef.current = { key, resource: next };
        setResource(next);
        setSize(next.size ?? null);
      })
      .catch((cause) => {
        if (!cancelled && !retainSnapshot) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [key, bust, connected, remotePath, load]);

  return { resource, size, error, setError, setSize };
}

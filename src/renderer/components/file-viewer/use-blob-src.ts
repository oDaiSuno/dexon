import type { EnvironmentId } from "@contract/environment";
import { useEffect, useRef, useState } from "react";

export function useBlobSrc(environmentId: EnvironmentId, filePath: string, sourceSessionId?: string | null, bust = 0) {
  const identity = JSON.stringify([environmentId, filePath, sourceSessionId, bust]);
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  const [src, setSrc] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revokeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadedIdentity(identity);
    setError(null);
    setSize(null);
    revokeRef.current?.();
    revokeRef.current = null;
    setSrc(null);
    void import("@/lib/file-blob")
      .then(({ fileToObjectUrl }) => fileToObjectUrl(environmentId, filePath, sourceSessionId))
      .then((r) => {
        if (cancelled) {
          r.revoke();
          return;
        }
        revokeRef.current = r.revoke;
        setSrc(r.url);
        setSize(r.size);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      revokeRef.current?.();
      revokeRef.current = null;
    };
  }, [environmentId, filePath, sourceSessionId, bust, identity]);

  return {
    src: loadedIdentity === identity ? src : null,
    size: loadedIdentity === identity ? size : null,
    error: loadedIdentity === identity ? error : null,
    setError,
    setSize,
  };
}

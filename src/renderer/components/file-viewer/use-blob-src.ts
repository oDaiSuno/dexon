import type { EnvironmentId } from "@contract/environment";
import { useEffect, useRef, useState } from "react";

export function useBlobSrc(environmentId: EnvironmentId, filePath: string, sourceSessionId?: string | null, bust = 0) {
  const target = `${environmentId}\0${filePath}\0${sourceSessionId ?? ""}`;
  const [loadedTarget, setLoadedTarget] = useState(target);
  const [src, setSrc] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentTarget = useRef(target);
  const revokeRef = useRef<(() => void) | null>(null);
  const pendingRead = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    if (currentTarget.current !== target) {
      currentTarget.current = target;
      revokeRef.current?.();
      revokeRef.current = null;
      setLoadedTarget(target);
      setSrc(null);
      setSize(null);
      setError(null);
    }
    const read = pendingRead.current
      .catch(() => {})
      .then(async () => {
        if (cancelled) return null;
        const { fileToObjectUrl } = await import("@/lib/file-blob");
        return fileToObjectUrl(environmentId, filePath, sourceSessionId);
      });
    pendingRead.current = read;
    void read
      .then((r) => {
        if (!r) return;
        if (cancelled) {
          r.revoke();
          return;
        }
        const revokePrevious = revokeRef.current;
        revokeRef.current = r.revoke;
        setSrc(r.url);
        setSize(r.size);
        setError(null);
        revokePrevious?.();
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [environmentId, filePath, sourceSessionId, bust, target]);

  useEffect(
    () => () => {
      revokeRef.current?.();
      revokeRef.current = null;
    },
    [],
  );

  return {
    src: loadedTarget === target ? src : null,
    size: loadedTarget === target ? size : null,
    error: loadedTarget === target ? error : null,
    setError,
    setSize,
  };
}

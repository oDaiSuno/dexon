import { useEffect, useRef, useState } from "react";

export function useBlobSrc(filePath: string, sourceSessionId?: string | null, bust = 0) {
  const [src, setSrc] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revokeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    revokeRef.current?.();
    revokeRef.current = null;
    setSrc(null);
    void import("@/lib/file-blob")
      .then(({ fileToObjectUrl }) => fileToObjectUrl(filePath, sourceSessionId))
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
  }, [filePath, sourceSessionId, bust]);

  return { src, size, error, setError, setSize };
}

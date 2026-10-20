import type { OlderHistoryOutcome } from "@/hooks/agent-session/use-session-history";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8000;

function retryDelay(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), RETRY_MAX_DELAY_MS);
}

export function useOlderHistory({
  visible,
  sessionId,
  previousCursor,
  hasOlder,
  loadingOlder,
  loadOlder,
  messagesLength,
  scrollContainerRef,
}: {
  visible: boolean;
  sessionId: string | null;
  previousCursor: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => Promise<OlderHistoryOutcome>;
  messagesLength: number;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const [stalledAt, setStalledAt] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ at: string; attempt: number } | null>(null);
  const busyRef = useRef(false);

  const position = `${sessionId ?? ""}\u0000${previousCursor ?? ""}`;
  const positionRef = useRef(position);
  positionRef.current = position;
  const halted = stalledAt === position;
  const failed = failure !== null && failure.at === position;
  const attempt = failed ? failure.attempt : 0;

  const attachSentinel = useCallback((node: HTMLDivElement | null) => setSentinel(node), []);

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!visible || !sentinel || !root) {
      setInView(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      root,
      rootMargin: "160px 0px 0px",
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollContainerRef, sentinel, visible]);

  const load = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const at = positionRef.current;
    try {
      const outcome = await loadOlder();
      if (outcome === "failed") {
        setFailure((previous) => ({ at, attempt: (previous?.at === at ? previous.attempt : 0) + 1 }));
        return;
      }
      if (outcome === "unavailable" || outcome === "discarded") return;
      setFailure(null);
      setStalledAt(outcome === "stalled" || outcome === "reset" ? at : null);
    } finally {
      busyRef.current = false;
    }
  }, [loadOlder]);

  const loadOlderHistory = useCallback(async () => {
    setStalledAt(null);
    setFailure(null);
    await load();
  }, [load]);

  useEffect(() => {
    if (!visible || !inView || !hasOlder || loadingOlder || halted || failed) return;
    void load();
  }, [failed, halted, hasOlder, inView, load, loadingOlder, messagesLength, position, visible]);

  useEffect(() => {
    if (!visible || !inView || !hasOlder || halted || !failed) return;
    const timer = setTimeout(() => void load(), retryDelay(attempt));
    return () => clearTimeout(timer);
  }, [attempt, failed, halted, hasOlder, inView, load, position, visible]);

  return { olderHistorySentinelRef: attachSentinel, loadOlderHistory, olderHistoryFailed: failed };
}

export type OlderHistory = ReturnType<typeof useOlderHistory>;

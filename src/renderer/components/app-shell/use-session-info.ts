import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ContextUsageInfo } from "@contract/types";

// Split from AppShell.tsx in Phase 2: the top-bar session info owner. Populated
// by ChatWindow and displayed in the top bar; copy feedback is localized and
// self-clearing.

type SessionCopyField = "file" | "id";
type SessionCopyFeedback = { field: SessionCopyField; status: "copied" | "error" };

export type { SessionCopyField, SessionCopyFeedback };

export type ContextUsageState = ContextUsageInfo;

export type UsageCompaction = {
  isCompacting: boolean;
  disabled: boolean;
  error: string | null;
  compact: () => void;
  abort: () => void;
};

export function useSessionInfo() {
  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const [sessionCopyFeedback, setSessionCopyFeedback] = useState<SessionCopyFeedback | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
    setSessionCopyFeedback(null);
    void copyText(value)
      .then(() => {
        setSessionCopyFeedback({ field, status: "copied" });
        sessionCopyTimerRef.current = setTimeout(() => setSessionCopyFeedback(null), 1_400);
      })
      .catch(() => {
        setSessionCopyFeedback({ field, status: "error" });
        sessionCopyTimerRef.current = setTimeout(() => setSessionCopyFeedback(null), 3_000);
      });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<ContextUsageState | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [compaction, setCompaction] = useState<UsageCompaction | null>(null);

  return {
    sessionStats,
    setSessionStats,
    contextUsage,
    setContextUsage,
    modelId,
    setModelId,
    compaction,
    setCompaction,
    sessionCopyFeedback,
    handleCopySessionField,
  };
}

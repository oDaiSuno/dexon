import { useEffect, useRef } from "react";
import type { useAgentSession } from "@/hooks/useAgentSession";
import type { UsageCompaction } from "../app-shell/use-session-info";
import type { Props } from "./shared";

export function useSessionReporting({
  sessionStats,
  contextUsage,
  compaction,
  displayModelId,
  onSessionStatsChange,
  onContextUsageChange,
  onCompactionChange,
  onModelIdChange,
}: Pick<ReturnType<typeof useAgentSession>, "sessionStats" | "contextUsage"> &
  Pick<Props, "onSessionStatsChange" | "onContextUsageChange" | "onCompactionChange" | "onModelIdChange"> & {
    compaction: UsageCompaction | null;
    displayModelId: string | null;
  }) {
  const statsKey = sessionStats
    ? [
        sessionStats.sessionId,
        sessionStats.sessionFile ?? "",
        sessionStats.sessionName ?? "",
        sessionStats.userMessages,
        sessionStats.assistantMessages,
        sessionStats.toolCalls,
        sessionStats.toolResults,
        sessionStats.totalMessages,
        sessionStats.tokens.input,
        sessionStats.tokens.output,
        sessionStats.tokens.cacheRead,
        sessionStats.tokens.cacheWrite,
        sessionStats.tokens.total,
        sessionStats.cost ?? 0,
        JSON.stringify(sessionStats.costs ?? null),
        sessionStats.lastCompactionAt ?? "",
      ].join("|")
    : null;

  const sessionStatsRef = useRef(sessionStats);

  sessionStatsRef.current = sessionStats;

  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);

  useEffect(
    () => () => {
      onSessionStatsChange?.(null);
    },
    [onSessionStatsChange],
  );
  const ctxKey = contextUsage ? JSON.stringify(contextUsage) : null;

  const contextUsageRef = useRef(contextUsage);

  contextUsageRef.current = contextUsage;

  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);

  useEffect(
    () => () => {
      onContextUsageChange?.(null);
    },
    [onContextUsageChange],
  );

  useEffect(() => {
    onCompactionChange?.(compaction);
  }, [compaction, onCompactionChange]);

  useEffect(
    () => () => {
      onCompactionChange?.(null);
    },
    [onCompactionChange],
  );

  useEffect(() => {
    onModelIdChange?.(displayModelId);
  }, [displayModelId, onModelIdChange]);

  useEffect(
    () => () => {
      onModelIdChange?.(null);
    },
    [onModelIdChange],
  );
}

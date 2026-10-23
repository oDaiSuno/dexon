import { useCallback, useEffect, useRef, useState } from "react";
import type { ManagedProcessLogRecord, ManagedProcessPublicInfo } from "@contract/processes";
import { isManagedProcessActiveState } from "@contract/processes";
import { call, subscribe } from "@/lib/api-client";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useProcessPanelState({
  onActiveCountChange,
  onOpenBrowser,
}: {
  onActiveCountChange?: (count: number) => void;
  onOpenBrowser?: () => void;
}) {
  const [processes, setProcesses] = useState<ManagedProcessPublicInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [records, setRecords] = useState<ManagedProcessLogRecord[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const listRevisionRef = useRef(0);
  const cursorRef = useRef<string | undefined>(undefined);
  const selectedIdRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const selected = processes.find((process) => process.processId === selectedId) ?? null;
  const selectedProcessId = selected?.processId ?? null;
  const selectedRunId = selected?.runId ?? null;
  selectedIdRef.current = selectedId;
  cursorRef.current = cursor;

  const refresh = useCallback(async () => {
    try {
      const snapshot = await call("processes.list", { includeExited: true });
      listRevisionRef.current = Math.max(listRevisionRef.current, snapshot.revision);
      setProcesses(snapshot.processes);
      onActiveCountChange?.(snapshot.processes.filter((process) => isManagedProcessActiveState(process.state)).length);
      setSelectedId((current) =>
        current && snapshot.processes.some((process) => process.processId === current)
          ? current
          : (snapshot.processes[0]?.processId ?? null),
      );
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [onActiveCountChange]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, 100);
  }, [refresh]);

  const readMore = useCallback(async (processId: string, runId: string, fromCursor?: string, reset = false) => {
    try {
      const result = await call("processes.read", {
        processId,
        runId,
        cursor: fromCursor,
        maxBytes: 256 * 1024,
        streams: ["stdout", "stderr", "system"],
      });
      if (selectedIdRef.current !== processId) return;
      setRecords((current) => {
        const next = reset ? result.records : [...current, ...result.records];
        const deduped = new Map(next.map((record) => [`${record.runId}:${record.seq}`, record]));
        return [...deduped.values()].slice(-2_000);
      });
      setCursor(result.nextCursor);
      setHasMore(result.truncated);
      setError(null);
      requestAnimationFrame(() => {
        const element = logRef.current;
        if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 160) {
          element.scrollTop = element.scrollHeight;
        }
      });
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void subscribe("processes.changed", "*", (event) => {
      if (event.revision <= listRevisionRef.current) return;
      scheduleRefresh();
    }).then((value) => {
      if (disposed) value();
      else unsubscribe = value;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [refresh, scheduleRefresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setRecords([]);
    setCursor(undefined);
    setHasMore(false);
    if (!selectedProcessId || !selectedRunId) return;
    void readMore(selectedProcessId, selectedRunId, undefined, true);
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void subscribe("processes.output", selectedProcessId, (event) => {
      if (event.runId !== selectedRunId) return;
      void readMore(selectedProcessId, selectedRunId, cursorRef.current);
    }).then((value) => {
      if (disposed) value();
      else unsubscribe = value;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [readMore, selectedProcessId, selectedRunId]);

  const invoke = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const openEndpoint = async (process: ManagedProcessPublicInfo, url: string) => {
    setBusy(true);
    try {
      const tab = await window.piBridge.browserCreateUserTab({
        url,
        ownerSessionId: process.ownerSessionId,
        activate: true,
      });
      window.dispatchEvent(new CustomEvent("dexon:open-browser-tab", { detail: { tabId: tab.id } }));
      onOpenBrowser?.();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return {
    processes,
    selected,
    selectedId,
    setSelectedId,
    records,
    cursor,
    hasMore,
    loading,
    busy,
    error,
    now,
    logRef,
    readMore,
    invoke,
    openEndpoint,
  };
}

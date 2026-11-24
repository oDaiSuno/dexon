import { useCallback, useEffect, useRef, useState } from "react";
import type { ManagedProcessLogRecord, ManagedProcessPublicInfo } from "@contract/processes";
import { isManagedProcessActiveState } from "@contract/processes";
import type { EnvironmentId } from "@contract/environment";
import { environmentAffordances } from "@/lib/environment-affordances";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { runEnvironmentCommand, useEnvironments, useEnvironmentsSnapshot } from "@/lib/environment-registry";
import { useI18n } from "@/i18n";

export function remoteLoopbackEndpoint(
  url: string,
): { protocol: "http:" | "https:"; remotePort: number; suffix: string } | null {
  const match = /^(https?):\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?([/?#][^\s\\]*)?$/i.exec(url);
  if (!match) return null;
  const protocol = match[1].toLowerCase() === "https" ? "https:" : "http:";
  const remotePort = match[3] === undefined ? (protocol === "https:" ? 443 : 80) : Number(match[3]);
  return Number.isInteger(remotePort) && remotePort > 0 && remotePort <= 65535
    ? { protocol, remotePort, suffix: match[4] ?? "" }
    : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useProcessPanelState({
  environmentId,
  onActiveCountChange,
  onOpenBrowser,
}: {
  environmentId: EnvironmentId;
  onActiveCountChange?: (count: number) => void;
  onOpenBrowser?: () => void;
}) {
  const { t } = useI18n();
  const affordances = environmentAffordances(useEnvironments().find((view) => view.id === environmentId));
  const { embeddedBrowser, isPrimary, portForwarding } = affordances;
  const portForwards = (useEnvironmentsSnapshot().portForwards ?? []).filter(
    (entry) => entry.environmentId === environmentId && entry.status === "active",
  );
  const scopeRef = useRef({ environmentId });
  if (scopeRef.current.environmentId !== environmentId) scopeRef.current = { environmentId };
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
      const snapshot = await getEnvironmentApiClient(environmentId).call("processes.list", { includeExited: true });
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
  }, [environmentId, onActiveCountChange]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, 100);
  }, [refresh]);

  const readMore = useCallback(
    async (processId: string, runId: string, fromCursor?: string, reset = false) => {
      try {
        const result = await getEnvironmentApiClient(environmentId).call("processes.read", {
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
    },
    [environmentId],
  );

  useEffect(() => {
    const scope = scopeRef.current;
    setBusy(false);
    setError(null);
    return () => {
      if (scopeRef.current === scope) scopeRef.current = { environmentId };
    };
  }, [environmentId]);

  useEffect(() => {
    void refresh();
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getEnvironmentApiClient(environmentId)
      .subscribe(
        "processes.changed",
        "*",
        (event) => {
          if (event.revision <= listRevisionRef.current) return;
          scheduleRefresh();
        },
        () => {
          listRevisionRef.current = 0;
          void refresh();
        },
      )
      .then((value) => {
        if (disposed) value();
        else unsubscribe = value;
      });
    return () => {
      disposed = true;
      unsubscribe?.();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [environmentId, refresh, scheduleRefresh]);

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
    void getEnvironmentApiClient(environmentId)
      .subscribe(
        "processes.output",
        selectedProcessId,
        (event) => {
          if (event.runId !== selectedRunId) return;
          void readMore(selectedProcessId, selectedRunId, cursorRef.current);
        },
        () => {
          void readMore(selectedProcessId, selectedRunId, undefined, true);
        },
      )
      .then((value) => {
        if (disposed) value();
        else unsubscribe = value;
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [environmentId, readMore, selectedProcessId, selectedRunId]);

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
    if (!embeddedBrowser) return;
    const endpoint = isPrimary ? null : remoteLoopbackEndpoint(url);
    if (!isPrimary && (!portForwarding || !endpoint)) return;
    const scope = scopeRef.current;
    setBusy(true);
    setError(null);
    try {
      let previewUrl = url;
      if (endpoint) {
        const entry = await runEnvironmentCommand({
          type: "open-port-forward",
          environmentId,
          remotePort: endpoint.remotePort,
          processId: process.processId,
          label: process.label,
        });
        if (scopeRef.current !== scope) return;
        if (
          entry.status !== "active" ||
          entry.environmentId !== environmentId ||
          entry.remotePort !== endpoint.remotePort
        ) {
          throw new Error("Forwarded preview is not active");
        }
        const base = new URL(entry.localUrl);
        previewUrl = `${endpoint.protocol}//${base.host}${endpoint.suffix.startsWith("/") ? "" : "/"}${endpoint.suffix}`;
      }
      const tab = await window.piBridge.browserCreateUserTab({
        url: previewUrl,
        ownerSessionId: process.ownerSessionId,
        activate: true,
      });
      if (scopeRef.current !== scope) return;
      window.dispatchEvent(new CustomEvent("dexon:open-browser-tab", { detail: { tabId: tab.id } }));
      onOpenBrowser?.();
    } catch (cause) {
      if (scopeRef.current === scope) {
        setError(
          isPrimary
            ? messageOf(cause)
            : t("remoteForwardOpenFailed", "Could not open the forwarded preview. Try again."),
        );
      }
    } finally {
      if (scopeRef.current === scope) setBusy(false);
    }
  };

  const closeForward = async (remotePort: number) => {
    if (!portForwarding) return;
    const scope = scopeRef.current;
    setBusy(true);
    setError(null);
    try {
      await runEnvironmentCommand({ type: "close-port-forward", environmentId, remotePort });
    } catch (cause) {
      if (scopeRef.current === scope) setError(messageOf(cause));
    } finally {
      if (scopeRef.current === scope) setBusy(false);
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
    closeForward,
    portForwards,
    affordances,
  };
}

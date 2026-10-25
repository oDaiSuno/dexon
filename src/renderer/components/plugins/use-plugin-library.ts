import { useCallback, useEffect, useMemo, useState } from "react";
import { call } from "@/lib/api-client";
import { sendAgentCommand } from "@/lib/agent-client";
import { useI18n } from "@/i18n";
import type { PluginPackageInfo, PluginsResponse } from "@/lib/api-types";
import { parseCapabilityIssue, type CapabilityIssue } from "@/components/CapabilityRequired";
import {
  findInstalledPackage,
  packageKey,
  pluginRequestError,
  safePluginError,
  type PendingCapabilityOperation,
  type PluginAction,
  type PluginScope,
} from "./plugin-shared";

export interface PluginLibrary {
  data: PluginsResponse | null;
  loading: boolean;
  error: string | null;
  packages: PluginPackageInfo[];
  selectedPackage: PluginPackageInfo | null;
  groupedPackages: { scope: PluginScope; packages: PluginPackageInfo[] }[];
  selected: string | null;
  addMode: boolean;
  installSource: string;
  installScope: PluginScope;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  capabilityIssue: CapabilityIssue | null;
  hasPendingCapabilityOperation: boolean;
  addBusy: boolean;
  setInstallSource: (value: string) => void;
  setInstallScope: (scope: PluginScope) => void;
  selectPackage: (key: string | null) => void;
  openAddMode: () => void;
  clearCapabilityPending: () => void;
  loadPlugins: () => Promise<void>;
  runAction: (action: PluginAction, pkg: PluginPackageInfo) => Promise<void>;
  installPluginSource: (source: string, scope: PluginScope) => Promise<void>;
  installPlugin: () => Promise<void>;
  retryCapabilityOperation: () => Promise<void>;
  reloadSession: () => Promise<void>;
}

export function usePluginLibrary({
  cwd,
  sessionId,
  onReloaded,
}: {
  cwd: string;
  sessionId: string | null;
  onReloaded?: () => void;
}): PluginLibrary {
  const { t } = useI18n();
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<PluginScope>("global");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [capabilityIssue, setCapabilityIssue] = useState<CapabilityIssue | null>(null);
  const [pendingCapabilityOperation, setPendingCapabilityOperation] = useState<PendingCapabilityOperation | null>(null);

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;

  const groupedPackages = useMemo(() => {
    return (["project", "global"] as PluginScope[])
      .map((scope) => ({ scope, packages: packages.filter((pkg) => pkg.scope === scope) }))
      .filter((group) => group.packages.length > 0);
  }, [packages]);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`);
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) {
        throw new Error(next.error ?? t("httpErrorStatus", "HTTP {status}").replace("{status}", String(res.status)));
      }
      setData(next);
      setAddMode((current) => next.packages.length === 0 || current);
      setSelected((current) => {
        if (current && next.packages.some((pkg) => packageKey(pkg) === current)) return current;
        return next.packages[0] ? packageKey(next.packages[0]) : null;
      });
    } catch (err) {
      setError(pluginRequestError(err, t("pluginsLoadFailed", "Failed to load plugins.")));
    } finally {
      setLoading(false);
    }
  }, [cwd, t]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const runAction = useCallback(
    async (action: PluginAction, pkg: PluginPackageInfo) => {
      const key = packageKey(pkg);
      setBusyKey(`${action}:${key}`);
      setActionError(null);
      setActionMessage(null);
      setCapabilityIssue(null);
      try {
        const res = await fetch("/api/plugins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, source: pkg.source, scope: pkg.scope, cwd }),
        });
        const next = (await res.json()) as PluginsResponse & {
          error?: string;
          code?: string;
          capability?: string;
        };
        if (!res.ok || next.error) {
          const issue = parseCapabilityIssue(next);
          if (issue) {
            setCapabilityIssue(issue);
            setPendingCapabilityOperation({ kind: "action", action, pkg });
            return;
          }
          throw new Error(
            safePluginError(
              next.error,
              t("httpErrorStatus", "HTTP {status}").replace("{status}", String(res.status)),
              t,
            ),
          );
        }
        setPendingCapabilityOperation(null);
        setData(next);
        if (action === "remove") {
          setSelected(next.packages[0] ? packageKey(next.packages[0]) : null);
          if (next.packages.length === 0) setAddMode(true);
          setActionMessage(t("pluginPackageRemoved", "Package removed."));
        } else {
          if (action === "install") setActionMessage(t("pluginPackageInstalled", "Package installed."));
          else if (action === "update") setActionMessage(t("pluginPackageUpdated", "Package updated."));
          else if (action === "disable") {
            setActionMessage(t("pluginPackageDisabledSuccessfully", "Package disabled."));
          } else setActionMessage(t("pluginPackageEnabled", "Package enabled."));
        }
      } catch (err) {
        setActionError(
          safePluginError(
            err instanceof Error ? err.message : undefined,
            t("pluginActionFailed", "Plugin action failed."),
            t,
          ),
        );
      } finally {
        setBusyKey(null);
      }
    },
    [cwd, t],
  );

  const installPluginSource = useCallback(
    async (source: string, scope: PluginScope) => {
      const key = `${scope}\0${source}`;
      setBusyKey(`install:${key}`);
      setActionError(null);
      setActionMessage(null);
      setCapabilityIssue(null);
      try {
        const res = await fetch("/api/plugins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "install", source, scope, cwd }),
        });
        const next = (await res.json()) as PluginsResponse & {
          error?: string;
          code?: string;
          capability?: string;
        };
        if (!res.ok || next.error) {
          const issue = parseCapabilityIssue(next);
          if (issue) {
            setCapabilityIssue(issue);
            setPendingCapabilityOperation({ kind: "install", source, scope });
            return;
          }
          throw new Error(
            safePluginError(
              next.error,
              t("httpErrorStatus", "HTTP {status}").replace("{status}", String(res.status)),
              t,
            ),
          );
        }
        setPendingCapabilityOperation(null);
        setData(next);
        const installed = findInstalledPackage(next.packages, source, scope);
        setSelected(installed ? packageKey(installed) : key);
        setAddMode(false);
        setInstallSource("");
        setActionMessage(t("pluginPackageInstalled", "Package installed."));
      } catch (err) {
        setActionError(
          safePluginError(
            err instanceof Error ? err.message : undefined,
            t("pluginInstallationFailed", "Plugin installation failed."),
            t,
          ),
        );
      } finally {
        setBusyKey(null);
      }
    },
    [cwd, t],
  );

  const installPlugin = useCallback(async () => {
    const source = installSource.trim();
    if (!source) return;
    await installPluginSource(source, installScope);
  }, [installPluginSource, installScope, installSource]);

  const retryCapabilityOperation = useCallback(async () => {
    const pending = pendingCapabilityOperation;
    if (!pending) return;
    setCapabilityIssue(null);
    if (pending.kind === "action") await runAction(pending.action, pending.pkg);
    else await installPluginSource(pending.source, pending.scope);
  }, [installPluginSource, pendingCapabilityOperation, runAction]);

  const reloadSession = useCallback(async () => {
    if (!sessionId) return;
    setBusyKey("reload");
    setActionError(null);
    setActionMessage(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      setData(await call("plugins.markReloaded", { cwd }));
      setActionMessage(t("pluginSessionReloaded", "Session reloaded."));
    } catch (err) {
      setActionError(pluginRequestError(err, t("pluginSessionReloadFailed", "Failed to reload session.")));
    } finally {
      setBusyKey(null);
    }
  }, [cwd, onReloaded, sessionId, t]);

  const selectPackage = useCallback((key: string | null) => {
    setSelected(key);
    setAddMode(false);
    setActionError(null);
    setActionMessage(null);
  }, []);

  const openAddMode = useCallback(() => {
    setAddMode(true);
    setActionError(null);
    setActionMessage(null);
  }, []);

  const clearCapabilityPending = useCallback(() => {
    setCapabilityIssue(null);
    setPendingCapabilityOperation(null);
  }, []);

  const addBusy = busyKey?.startsWith("install:") ?? false;

  return {
    data,
    loading,
    error,
    packages,
    selectedPackage,
    groupedPackages,
    selected,
    addMode,
    installSource,
    installScope,
    busyKey,
    actionError,
    actionMessage,
    capabilityIssue,
    hasPendingCapabilityOperation: pendingCapabilityOperation !== null,
    addBusy,
    setInstallSource,
    setInstallScope,
    selectPackage,
    openAddMode,
    clearCapabilityPending,
    loadPlugins,
    runAction,
    installPluginSource,
    installPlugin,
    retryCapabilityOperation,
    reloadSession,
  };
}

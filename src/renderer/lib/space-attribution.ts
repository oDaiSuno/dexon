import { useMemo, useSyncExternalStore } from "react";
import { useI18n } from "@/i18n";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId, type EnvironmentView } from "@contract/environment";
import type { EnvironmentsSnapshot } from "@contract/environment-commands";
import type { HostStatus } from "@contract/desktop";
import { getPrimaryHostSnapshot, usePrimaryHostSnapshot, type PrimaryHostSnapshot } from "./primary-host-status";
import { workspaceStore, type WorkspaceSnapshot } from "./workspace-store";
import { environmentRegistry, useEnvironmentsSnapshot } from "./environment-registry";
import { presentConnection, type ConnectionPresentation } from "./connection-presentation";

export interface LocalSpaceAttribution {
  kind: "local";
  state: "online" | "reconnecting" | "unresponsive" | "offline";
  hostStatus: HostStatus;
  canSend: boolean;
  detail?: string;
}

export interface PendingSpaceAttribution {
  kind: "pending";
  environmentId: EnvironmentId;
  canSend: false;
}

export interface RemoteSpaceAttribution {
  kind: "remote";
  environmentId: EnvironmentId;
  label: string;
  path: string;
  displayPath: string;
  view: EnvironmentView;
  presentation: ConnectionPresentation;
  detachedDaemon: boolean;
  externallyManagedDaemon: boolean;
}

export type SpaceAttribution = LocalSpaceAttribution | RemoteSpaceAttribution | PendingSpaceAttribution;

export interface SendGate {
  allowed: boolean;
  label: string;
  hint: string;
}

function primaryAttribution(
  snapshot: EnvironmentsSnapshot,
  host: PrimaryHostSnapshot,
  now: number,
): LocalSpaceAttribution {
  const view = snapshot.environments.find((item) => item.id === PRIMARY_ENVIRONMENT_ID);
  const presentation = view ? presentConnection(view, now) : null;
  const canSend = (presentation?.canSend ?? true) && host.status === "ready";
  const state = canSend
    ? "online"
    : host.status === "unresponsive"
      ? "unresponsive"
      : host.status === "crashed" || host.status === "stopped"
        ? "offline"
        : host.status === "starting" || presentation?.tone === "pending"
          ? "reconnecting"
          : "offline";
  return { kind: "local", state, hostStatus: host.status, canSend, detail: host.detail };
}

function deriveSpaceAttribution(
  workspace: WorkspaceSnapshot,
  snapshot: EnvironmentsSnapshot,
  now: number,
  host: PrimaryHostSnapshot,
): SpaceAttribution {
  const environmentId = workspace.focus.environmentId;

  if (environmentId === PRIMARY_ENVIRONMENT_ID) {
    return primaryAttribution(snapshot, host, now);
  }

  const spaceKey = workspace.focus.spaceKey;
  const space = workspace.spaces.find((s) => s.key === spaceKey);
  const view = snapshot.environments.find((v) => v.id === environmentId);
  const policy = snapshot.policy;

  if (!view) {
    return { kind: "pending", environmentId, canSend: false };
  }

  return {
    kind: "remote",
    environmentId,
    label: view.label,
    path: space?.path ?? "",
    displayPath: space?.displayPath ?? "",
    view,
    presentation: presentConnection(view, now),
    detachedDaemon: policy.detachedDaemon,
    externallyManagedDaemon: view.target.kind === "websocket" || view.runtime?.ownership === "external",
  };
}

function environmentCanSend(
  environmentId: EnvironmentId,
  snapshot: EnvironmentsSnapshot,
  host: PrimaryHostSnapshot,
): boolean {
  if (environmentId === PRIMARY_ENVIRONMENT_ID) return primaryAttribution(snapshot, host, 0).canSend;
  const view = snapshot.environments.find((item) => item.id === environmentId);
  return Boolean(view && presentConnection(view, 0).canSend);
}

export function canSendToEnvironment(environmentId: EnvironmentId): boolean {
  return environmentCanSend(environmentId, environmentRegistry.getSnapshot(), getPrimaryHostSnapshot());
}

function deriveSendGate(
  workspace: WorkspaceSnapshot,
  snapshot: EnvironmentsSnapshot,
  t: (key: string, fallback: string) => string,
  host: PrimaryHostSnapshot,
): SendGate {
  const environmentId = workspace.focus.environmentId;
  const allowed = environmentCanSend(environmentId, snapshot, host);
  if (!allowed && environmentId === PRIMARY_ENVIRONMENT_ID) {
    return host.status === "unresponsive"
      ? {
          allowed: false,
          label: t("primaryHostUnresponsive", "Background service is not responding…"),
          hint: t("primaryHostUnresponsiveHint", "Wait for the background service or click Restart now above"),
        }
      : {
          allowed: false,
          label: t("primaryHostReconnecting", "Reconnecting to background service…"),
          hint: t("primaryHostSendHint", "You can send after the background service recovers"),
        };
  }
  return allowed
    ? { allowed: true, label: "", hint: "" }
    : {
        allowed: false,
        label: t("remoteAttributionWaiting", "Waiting to reconnect…"),
        hint: t("remoteAttributionSendHint", "You can send after reconnecting"),
      };
}

function useWorkspaceSnapshot(): WorkspaceSnapshot {
  return useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getSnapshot, workspaceStore.getSnapshot);
}

export function useSpaceAttribution(): SpaceAttribution {
  const workspace = useWorkspaceSnapshot();
  const environments = useEnvironmentsSnapshot();
  const now = useNow();
  const host = usePrimaryHostSnapshot();
  return useMemo(
    () => deriveSpaceAttribution(workspace, environments, now, host),
    [workspace, environments, now, host],
  );
}

export function useSendGate(): SendGate {
  const { t } = useI18n();
  const workspace = useWorkspaceSnapshot();
  const environments = useEnvironmentsSnapshot();
  const host = usePrimaryHostSnapshot();
  return useMemo(() => deriveSendGate(workspace, environments, t, host), [workspace, environments, t, host]);
}

let nowTick = Date.now();
let nowTimer: ReturnType<typeof setInterval> | null = null;
const nowListeners = new Set<() => void>();
const getNow = () => nowTick;

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (nowTimer === null) {
    nowTick = Date.now();
    nowTimer = setInterval(() => {
      nowTick = Date.now();
      for (const notify of nowListeners) notify();
    }, 1000);
  }
  return () => {
    nowListeners.delete(listener);
    if (!nowListeners.size && nowTimer !== null) {
      clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribeNow, getNow, getNow);
}

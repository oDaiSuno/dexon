import { useMemo, useSyncExternalStore } from "react";
import { useI18n } from "@/i18n";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId, type EnvironmentView } from "@contract/environment";
import type { EnvironmentsSnapshot } from "@contract/environment-commands";
import { workspaceStore, type WorkspaceSnapshot } from "./workspace-store";
import { environmentRegistry, useEnvironmentsSnapshot } from "./environment-registry";
import { presentConnection, type ConnectionPresentation } from "./connection-presentation";

export interface LocalSpaceAttribution {
  kind: "local";
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

export type SpaceAttribution = LocalSpaceAttribution | RemoteSpaceAttribution;

export interface SendGate {
  allowed: boolean;
  label: string;
  hint: string;
}

function deriveSpaceAttribution(
  workspace: WorkspaceSnapshot,
  snapshot: EnvironmentsSnapshot,
  now: number,
): SpaceAttribution {
  const environmentId = workspace.focus.environmentId;

  if (environmentId === PRIMARY_ENVIRONMENT_ID) {
    return { kind: "local" };
  }

  const spaceKey = workspace.focus.spaceKey;
  const space = workspace.spaces.find((s) => s.key === spaceKey);
  const view = snapshot.environments.find((v) => v.id === environmentId);
  const policy = snapshot.policy;

  if (!view) {
    return { kind: "local" };
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

function environmentCanSend(environmentId: EnvironmentId, snapshot: EnvironmentsSnapshot): boolean {
  if (environmentId === PRIMARY_ENVIRONMENT_ID) return true;
  const view = snapshot.environments.find((item) => item.id === environmentId);
  return Boolean(view && presentConnection(view, 0).canSend);
}

export function canSendToEnvironment(environmentId: EnvironmentId): boolean {
  return environmentCanSend(environmentId, environmentRegistry.getSnapshot());
}

function deriveSendGate(
  workspace: WorkspaceSnapshot,
  snapshot: EnvironmentsSnapshot,
  t: (key: string, fallback: string) => string,
): SendGate {
  const allowed = environmentCanSend(workspace.focus.environmentId, snapshot);
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
  return useMemo(() => deriveSpaceAttribution(workspace, environments, now), [workspace, environments, now]);
}

export function useSendGate(): SendGate {
  const { t } = useI18n();
  const workspace = useWorkspaceSnapshot();
  const environments = useEnvironmentsSnapshot();
  return useMemo(() => deriveSendGate(workspace, environments, t), [workspace, environments, t]);
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

import type { ManagedProcessPublicInfo } from "@contract/processes";
import { describeWorkspaceKey } from "@shared/workspace-ref";

export function processPreviewEndpoints(process: ManagedProcessPublicInfo): { id: string; url: string }[] {
  if (!process.endpointViews?.length) return process.endpoints;
  return process.endpointViews.flatMap((view) =>
    view.state === "available" && view.openUrl ? [{ id: view.id, url: view.openUrl }] : [],
  );
}

export function browserTunnelForUrl(processes: ManagedProcessPublicInfo[], url: string) {
  const target = parseUrl(url);
  if (!target || target.hostname !== "127.0.0.1") return null;
  for (const process of processes) {
    for (const view of process.endpointViews ?? []) {
      if (view.state !== "available" || !view.openUrl) continue;
      const tunnel = parseUrl(view.openUrl);
      if (tunnel?.host !== target.host) continue;
      const hostLabel =
        view.remoteHostLabel ?? describeWorkspaceKey(process.workspaceKey ?? process.cwdDisplay).hostLabel;
      if (hostLabel) return { hostLabel, remotePort: view.remotePort };
    }
  }
  return null;
}

function parseUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

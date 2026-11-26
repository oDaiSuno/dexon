import { useEffect, useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import type { InboxItem } from "@shared/automation/views";
import { getEnvironmentConnection, useEnvironmentsSnapshot } from "./environment-registry";

export type AutomationBadgeSeverity = "none" | "warning" | "danger";

export interface AutomationSidebarBadge {
  readonly count: number;
  readonly severity: AutomationBadgeSeverity;
  readonly attentionCount: number;
  readonly approvalCount: number;
  readonly byEnvironment: Readonly<Record<string, { count: number; severity: AutomationBadgeSeverity }>>;
}

const EMPTY_BADGE: AutomationSidebarBadge = {
  count: 0,
  severity: "none",
  attentionCount: 0,
  approvalCount: 0,
  byEnvironment: {},
};

function summarizeInbox(byEnv: Map<EnvironmentId, readonly InboxItem[]>): AutomationSidebarBadge {
  let attentionCount = 0;
  let approvalCount = 0;
  const byEnvironment: Record<string, { count: number; severity: AutomationBadgeSeverity }> = {};
  for (const [envId, items] of byEnv) {
    let envAttention = 0;
    let envApproval = 0;
    for (const item of items) {
      if (item.kind === "attention") envAttention += 1;
      else envApproval += 1;
    }
    const envCount = envAttention + envApproval;
    if (envCount > 0) {
      byEnvironment[envId] = {
        count: envCount,
        severity: envAttention > 0 ? "danger" : "warning",
      };
    }
    attentionCount += envAttention;
    approvalCount += envApproval;
  }
  const count = attentionCount + approvalCount;
  const severity: AutomationBadgeSeverity = attentionCount > 0 ? "danger" : approvalCount > 0 ? "warning" : "none";
  return { count, severity, attentionCount, approvalCount, byEnvironment };
}

export function useAutomationSidebarBadge(): AutomationSidebarBadge {
  const { environments } = useEnvironmentsSnapshot();
  const [badge, setBadge] = useState<AutomationSidebarBadge>(EMPTY_BADGE);

  const connectedKey = environments
    .filter((env) => env.status.phase === "connected")
    .map((env) => env.id)
    .sort()
    .join(",");

  useEffect(() => {
    const connectedIds = connectedKey ? (connectedKey.split(",") as EnvironmentId[]) : [];
    if (connectedIds.length === 0) {
      setBadge(EMPTY_BADGE);
      return;
    }
    let disposed = false;
    const inboxByEnv = new Map<EnvironmentId, readonly InboxItem[]>();
    const unsubscribes: Array<() => void> = [];

    const publish = () => {
      if (disposed) return;
      setBadge(summarizeInbox(inboxByEnv));
    };

    const refreshEnv = async (envId: EnvironmentId) => {
      try {
        const connection = getEnvironmentConnection(envId);
        const result = await connection.call("automation.listInbox");
        if (disposed) return;
        inboxByEnv.set(envId, result.items);
        publish();
      } catch {
        if (disposed) return;
        inboxByEnv.delete(envId);
        publish();
      }
    };

    for (const envId of connectedIds) {
      void refreshEnv(envId);
      const connection = getEnvironmentConnection(envId);
      void connection
        .subscribe("automation.changed", "*", () => {
          void refreshEnv(envId);
        })
        .then((unsubscribe) => {
          if (disposed) unsubscribe();
          else unsubscribes.push(unsubscribe);
        })
        .catch(() => {});
    }

    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [connectedKey]);

  return badge;
}

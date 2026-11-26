import { createContext, useContext } from "react";
import type { EnvironmentId, EnvironmentView } from "@contract/environment";
import type { ApiMethod, ApiParams, ApiResult } from "@contract/api";
import type { AutomationCommand, AutomationCommandResult } from "@contract/automation-commands";
import type { TaskView, TaskRevisionView, InboxItem, RunSummaryView } from "@shared/automation/views";
import type { AutomationRouteTarget } from "@/lib/automation-request";

export type HostStatus = "online" | "offline" | "connecting" | "backoff" | "blocked";
export interface AutomationHost {
  environment: EnvironmentView;
  status: HostStatus;
  error: string | null;
  loading: boolean;
}
export interface HostedTask {
  environmentId: EnvironmentId;
  task: TaskView;
  revision: TaskRevisionView | null;
  latestRun: RunSummaryView | null;
}
export interface HostedInbox {
  environmentId: EnvironmentId;
  item: InboxItem;
}
export interface HostedRun {
  environmentId: EnvironmentId;
  run: RunSummaryView;
}
export interface AutomationWorkspace {
  hosts: readonly AutomationHost[];
  tasks: readonly HostedTask[];
  inbox: readonly HostedInbox[];
  runs: readonly HostedRun[];
  loading: boolean;
  nativeConsentPending: { label: string } | null;
  refresh: () => Promise<void>;
  reconnectEnvironment: (environmentId: EnvironmentId) => Promise<void>;
  call: <M extends ApiMethod>(environmentId: EnvironmentId, method: M, params?: ApiParams<M>) => Promise<ApiResult<M>>;
  command: <C extends AutomationCommand>(command: C, label?: string) => Promise<AutomationCommandResult<C>>;
  navigate: (target: AutomationRouteTarget) => void;
  openVault: (environmentId?: EnvironmentId, locked?: boolean) => void;
  openInbox: (item: HostedInbox) => void;
  startTask: (task: HostedTask) => void;
  notify: (message: string) => void;
  onClose: () => void;
}
export const AutomationWorkspaceContext = createContext<AutomationWorkspace | null>(null);
export function useAutomationWorkspace(): AutomationWorkspace {
  const workspace = useContext(AutomationWorkspaceContext);
  if (!workspace) throw new Error("Automation workspace is unavailable");
  return workspace;
}

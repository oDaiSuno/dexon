import type { EnvironmentId, EnvironmentView, SshEnvironmentTarget, WebSocketEnvironmentTarget } from "./environment";
import type { ConnectionFailure, ProvisioningStep } from "./environment-status";
export type DraftTarget =
  Omit<SshEnvironmentTarget, "expectedEnvironmentId"> | Omit<WebSocketEnvironmentTarget, "expectedEnvironmentId">;
export interface EnvironmentDraft {
  label: string;
  target: DraftTarget;
  authToken?: string;
}
export type EnvironmentPatch = EnvironmentDraft;
export interface LifecyclePolicy {
  detachedDaemon: boolean;
  autoReconnect: boolean;
}
export const DEFAULT_LIFECYCLE_POLICY: LifecyclePolicy = { detachedDaemon: true, autoReconnect: true };
export interface RemoteRuntimeMeta {
  nodeVersion: string;
  payloadVersion: string;
  startedAt: number;
  ownership: "managed" | "external";
  updatePending: boolean;
}
export interface DiscoveredSshHost {
  alias: string;
  hostname: string;
  user: string | null;
  port: number;
  proxyJump: string | null;
  identityFile: string | null;
  sourceFile: string;
  addedAs: EnvironmentId | null;
}
export interface SshHostDiscovery {
  configPath: string;
  hosts: DiscoveredSshHost[];
  error: string | null;
}
export interface ProbeReport {
  steps: { step: ProvisioningStep; outcome: "passed" | "failed" | "skipped" }[];
  latencyMs: number | null;
  nodeVersion: string | null;
  daemon: {
    running: boolean;
    since: number | null;
    ownership: "managed" | "external" | null;
    payloadVersion: string | null;
  } | null;
  failure: ConnectionFailure | null;
}
export type RemoteDaemonChoice = "keep" | "stop";
export interface RemoveOutcome {
  remoteDaemon: "kept" | "stopped" | "not-owned" | "unreachable";
}
export type PortForwardStatus = "active" | "reconnecting" | "stopped" | "error";
export interface PortForwardEntry {
  id: string;
  environmentId: EnvironmentId;
  remotePort: number;
  localPort: number;
  localUrl: string;
  processId?: string;
  label?: string;
  status: PortForwardStatus;
  error?: string;
}
export type EnvironmentCommand =
  | { type: "add"; draft: EnvironmentDraft; connect: boolean }
  | { type: "update"; environmentId: EnvironmentId; draft: EnvironmentDraft }
  | { type: "test"; subject: { environmentId: EnvironmentId } | { draft: EnvironmentDraft } }
  | { type: "connect"; environmentId: EnvironmentId }
  | { type: "disconnect"; environmentId: EnvironmentId }
  | { type: "trust"; environmentId: EnvironmentId; trust: "host-key" | "environment-identity" }
  | { type: "restart-daemon"; environmentId: EnvironmentId }
  | { type: "remove"; environmentId: EnvironmentId; remoteDaemon: RemoteDaemonChoice }
  | { type: "set-policy"; policy: Partial<LifecyclePolicy> }
  | { type: "discover-ssh-hosts" }
  | { type: "list-port-forwards"; environmentId?: EnvironmentId }
  | {
      type: "open-port-forward";
      environmentId: EnvironmentId;
      remotePort: number;
      processId?: string;
      label?: string;
    }
  | { type: "close-port-forward"; environmentId: EnvironmentId; remotePort: number };
export interface EnvironmentCommandResults {
  add: EnvironmentView;
  update: EnvironmentView;
  test: ProbeReport;
  connect: EnvironmentView;
  disconnect: EnvironmentView;
  trust: EnvironmentView;
  "restart-daemon": EnvironmentView;
  remove: RemoveOutcome;
  "set-policy": LifecyclePolicy;
  "discover-ssh-hosts": SshHostDiscovery;
  "list-port-forwards": PortForwardEntry[];
  "open-port-forward": PortForwardEntry;
  "close-port-forward": { closed: boolean };
}
export type EnvironmentCommandResult<C extends EnvironmentCommand> = EnvironmentCommandResults[C["type"]];
export interface EnvironmentsSnapshot {
  revision: number;
  policy: LifecyclePolicy;
  environments: EnvironmentView[];
  portForwards?: PortForwardEntry[];
}

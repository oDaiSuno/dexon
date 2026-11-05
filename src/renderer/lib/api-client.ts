import { createRpcClient, type PiRpc } from "@contract/rpc";
import type { ApiMethod, ApiParams, ApiResult, StreamTopic, Streams } from "@contract/api";
import type { DefaultThinkingLevel } from "@contract/types";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { createEnvironmentApiClient } from "./environment-connection";
import { requestEnvironmentPort } from "./environment-port";
import {
  getActiveEnvironmentConnection,
  getActiveEnvironmentId,
  getEnvironmentConnection,
  getSessionEnvironmentId,
  registerEnvironmentSessions,
  registerEnvironmentSession,
} from "./environment-registry";

let rpc: PiRpc | null = null;
let connectPromise: Promise<PiRpc> | null = null;

export function resetRpc(): void {
  try {
    rpc?.close();
  } catch {}
  rpc = null;
  connectPromise = null;
}

const HOST_READY_TIMEOUT_MS = 30_000;
const PING_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} (timeout ${ms}ms)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function requestHostPort(): Promise<MessagePort> {
  return (await requestEnvironmentPort(PRIMARY_ENVIRONMENT_ID)).port;
}

async function waitForHostReady(): Promise<void> {
  if (!window.piBridge) {
    throw new Error("piBridge not available — not running inside Electron?");
  }
  let status = await window.piBridge.getHostStatus();
  if (status === "ready") return;
  if (status === "crashed") {
    throw new Error("Agent Host crashed before UI connected");
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`Agent Host not ready (status=${status})`));
    }, HOST_READY_TIMEOUT_MS);

    const off = window.piBridge!.onHostStatus((s) => {
      status = s.status;
      if (s.status === "ready") {
        clearTimeout(timer);
        off();
        resolve();
      } else if (s.status === "crashed") {
        clearTimeout(timer);
        off();
        reject(new Error(s.detail || "Agent Host crashed"));
      }
    });

    void window.piBridge!.getHostStatus().then((s) => {
      if (s === "ready") {
        clearTimeout(timer);
        off();
        resolve();
      } else if (s === "crashed") {
        clearTimeout(timer);
        off();
        reject(new Error("Agent Host crashed"));
      }
    });
  });
}

export async function ensureRpc(): Promise<PiRpc> {
  if (rpc) return rpc;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    if (!window.piBridge) {
      throw new Error("piBridge not available — not running inside Electron?");
    }
    await waitForHostReady();
    const port = await requestHostPort();
    const client = createRpcClient(port);
    await withTimeout(client.call("host.ping"), PING_TIMEOUT_MS, "host.ping failed");
    rpc = client;
    return client;
  })();

  try {
    return await connectPromise;
  } catch (e) {
    connectPromise = null;
    rpc = null;
    throw e;
  }
}

export function getRpc(): PiRpc | null {
  return rpc;
}

export async function call<M extends ApiMethod>(
  method: M,
  ...args: ApiParams<M> extends void ? [] | [void] : [ApiParams<M>]
): Promise<ApiResult<M>> {
  if (getActiveEnvironmentId() !== PRIMARY_ENVIRONMENT_ID) {
    return getActiveEnvironmentConnection().call(method, ...(args as never));
  }
  return callPrimary(method, ...(args as never));
}

export async function subscribe<T extends StreamTopic>(
  topic: T,
  key: string,
  on: (ev: Streams[T]) => void,
  onGap?: () => void,
): Promise<() => void> {
  if (getActiveEnvironmentId() !== PRIMARY_ENVIRONMENT_ID) {
    return getActiveEnvironmentConnection().subscribe(topic, key, on, onGap);
  }
  return subscribePrimary(topic, key, on);
}

async function callPrimary<M extends ApiMethod>(
  method: M,
  ...args: ApiParams<M> extends void ? [] | [void] : [ApiParams<M>]
): Promise<ApiResult<M>> {
  const client = await ensureRpc();
  const result = await client.call(method, ...(args as never));
  if (method === "sessions.list" && Array.isArray((result as ApiResult<"sessions.list">)?.sessions))
    registerEnvironmentSessions(PRIMARY_ENVIRONMENT_ID, (result as ApiResult<"sessions.list">).sessions);
  if (method === "agent.new" && typeof (result as ApiResult<"agent.new">)?.sessionId === "string")
    registerEnvironmentSession(PRIMARY_ENVIRONMENT_ID, (result as ApiResult<"agent.new">).sessionId);
  return result;
}

async function subscribePrimary<T extends StreamTopic>(
  topic: T,
  key: string,
  on: (event: Streams[T]) => void,
): Promise<() => void> {
  return (await ensureRpc()).subscribe(topic, key, on);
}

const primaryApiClient = createEnvironmentApiClient({ call: callPrimary, subscribe: subscribePrimary });

export function getEnvironmentApiClient(environmentId: EnvironmentId) {
  return environmentId === PRIMARY_ENVIRONMENT_ID
    ? primaryApiClient
    : createEnvironmentApiClient(getEnvironmentConnection(environmentId));
}

export function getSessionApiClient(sessionId: string) {
  return getEnvironmentApiClient(getSessionEnvironmentId(sessionId));
}

export async function listSessions() {
  return call("sessions.list");
}

export async function getSession(
  id: string,
  includeState?: boolean,
  traceId?: string,
  historyWindow?: ApiParams<"sessions.get">["historyWindow"],
) {
  return getSessionApiClient(id).getSession(id, includeState, traceId, historyWindow);
}

export async function getSessionContext(
  id: string,
  leafId?: string,
  historyWindow?: ApiParams<"sessions.context">["historyWindow"],
) {
  return getSessionApiClient(id).getSessionContext(id, leafId, historyWindow);
}

export async function getSessionContextPage(id: string, cursor: string, maxTurns?: number, maxBytes?: number) {
  return getSessionApiClient(id).getSessionContextPage(id, cursor, maxTurns, maxBytes);
}

export async function getSessionEntryContent(id: string, entryId: string, blockIndex?: number) {
  return getSessionApiClient(id).getSessionEntryContent(id, entryId, blockIndex);
}

export async function exportSession(id: string, format: "md" | "json" = "md") {
  return getSessionApiClient(id).exportSession(id, format);
}

export async function deleteSession(id: string) {
  return getSessionApiClient(id).deleteSession(id);
}

export async function getSessionDescendants(id: string) {
  return getSessionApiClient(id).getSessionDescendants(id);
}

export async function renameSession(id: string, name: string) {
  return getSessionApiClient(id).renameSession(id, name);
}

export async function newAgent(params: ApiParams<"agent.new">) {
  return call("agent.new", params);
}

export async function agentCommand(sessionId: string, command: Record<string, unknown>) {
  return getSessionApiClient(sessionId).agentCommand(sessionId, command);
}

export async function agentState(sessionId: string) {
  return getSessionApiClient(sessionId).agentState(sessionId);
}

export async function listModels(cwd?: string) {
  return call("models.list", cwd ? { cwd } : undefined);
}

export async function refreshModels(cwd: string | undefined, requestId: string) {
  return call("models.refresh", { ...(cwd ? { cwd } : {}), requestId });
}

export async function cancelModelsRefresh(requestId: string) {
  return call("models.refreshCancel", { requestId });
}

export async function getModelPreferences(cwd?: string) {
  return call("models.preferences.get", cwd ? { cwd } : undefined);
}

export async function setModelPreferences(cwd: string | undefined, enabledModels: string[] | null) {
  return call("models.preferences.set", { ...(cwd ? { cwd } : {}), enabledModels });
}

export async function getModelDefaults(cwd?: string) {
  return call("models.defaults.get", cwd ? { cwd } : undefined);
}

export async function setModelDefaults(
  cwd: string | undefined,
  change: { model?: { provider: string; modelId: string }; thinkingLevel?: DefaultThinkingLevel },
) {
  return call("models.defaults.set", { ...(cwd ? { cwd } : {}), ...change });
}

export async function getProviderChannels() {
  return call("modelsConfig.channels.get");
}

export async function setProviderChannelEnabled(provider: string, enabled: boolean) {
  return call("modelsConfig.channels.setEnabled", { provider, enabled });
}

export async function testProviderChannel(provider: string) {
  return call("modelsConfig.channels.test", { provider });
}

export async function listWorktrees(projectRoot: string) {
  return call("worktrees.list", { projectRoot });
}

export async function validateCwd(path: string) {
  return call("system.validateCwd", { path });
}

export async function defaultCwd() {
  return call("system.defaultCwd");
}

export async function getHome() {
  return call("system.home");
}

export async function listFiles(path: string) {
  return call("files.list", { path });
}

export async function readFile(path: string, sourceSessionId?: string) {
  return call("files.read", { path, sourceSessionId });
}

export async function fileMeta(path: string, sourceSessionId?: string) {
  return call("files.meta", { path, sourceSessionId });
}

export async function fileIndex(root: string, query?: string) {
  return call("files.index", { root, query });
}

export async function subscribeAgentEvents(
  sessionId: string,
  on: (ev: Streams["agent.events"]) => void,
  onGap?: () => void,
) {
  return getSessionApiClient(sessionId).subscribeAgentEvents(sessionId, on, onGap);
}

export async function subscribeRunning(on: (ev: Streams["agent.running"]) => void) {
  return subscribe("agent.running", "*", on);
}

export async function subscribeSessionsChanged(on: (ev: Streams["sessions.changed"]) => void) {
  return subscribe("sessions.changed", "*", on);
}

export async function subscribeAuthLogin(provider: string, on: (ev: Streams["auth.login"]) => void) {
  return subscribe("auth.login", provider, on);
}

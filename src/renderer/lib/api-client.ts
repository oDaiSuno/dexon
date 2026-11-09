import type { PiRpc } from "@contract/rpc";
import type { ApiMethod, ApiParams, ApiResult, StreamTopic, Streams } from "@contract/api";
import type { DefaultThinkingLevel } from "@contract/types";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { createEnvironmentApiClient } from "./environment-connection";
import {
  environmentRegistry,
  getActiveEnvironmentConnection,
  getEnvironmentConnection,
  getSessionEnvironmentId,
} from "./environment-registry";

export function resetRpc(): void {
  environmentRegistry.findConnection(PRIMARY_ENVIRONMENT_ID)?.close();
}

export function ensureRpc(): Promise<PiRpc> {
  return getEnvironmentConnection(PRIMARY_ENVIRONMENT_ID).ensureRpc();
}

export function getRpc(): PiRpc | null {
  return environmentRegistry.findConnection(PRIMARY_ENVIRONMENT_ID)?.getRpc() ?? null;
}

export function call<M extends ApiMethod>(
  method: M,
  ...args: ApiParams<M> extends void ? [] | [void] : [ApiParams<M>]
): Promise<ApiResult<M>> {
  return getActiveEnvironmentConnection().call(method, ...(args as never));
}

export function subscribe<T extends StreamTopic>(
  topic: T,
  key: string,
  on: (event: Streams[T]) => void,
  onGap?: () => void,
): Promise<() => void> {
  return getActiveEnvironmentConnection().subscribe(topic, key, on, onGap);
}

export function getEnvironmentApiClient(environmentId: EnvironmentId) {
  return createEnvironmentApiClient(getEnvironmentConnection(environmentId));
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

export async function subscribeRunning(on: (ev: Streams["agent.running"]) => void, onGap?: () => void) {
  return subscribe("agent.running", "*", on, onGap);
}

export async function subscribeSessionsChanged(on: (ev: Streams["sessions.changed"]) => void, onGap?: () => void) {
  return subscribe("sessions.changed", "*", on, onGap);
}

export async function subscribeAuthLogin(
  provider: string,
  on: (ev: Streams["auth.login"]) => void,
  onGap?: () => void,
) {
  return subscribe("auth.login", provider, on, onGap);
}

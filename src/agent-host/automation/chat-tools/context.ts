import type { ChannelsSnapshot } from "../../../shared/channel-types";
import type { AutomationRuntime } from "../types";

export interface AutomationChatChannelReader {
  snapshot(): Promise<ChannelsSnapshot>;
}

export interface AutomationChatHostContext {
  readonly runtime: AutomationRuntime;
  readonly channels: AutomationChatChannelReader;
}

let hostContext: AutomationChatHostContext | null = null;

export function initializeAutomationChatHost(context: AutomationChatHostContext): void {
  hostContext = context;
}

export function clearAutomationChatHost(): void {
  hostContext = null;
}

export function peekAutomationChatHost(): AutomationChatHostContext | null {
  return hostContext;
}

export function isAutomationChatReady(): boolean {
  return hostContext !== null && hostContext.runtime.status().kind === "ready";
}

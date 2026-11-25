export { createAutomationRuntime } from "./runtime";
export {
  clearAutomationChatHost,
  initializeAutomationChatHost,
  isAutomationChatReady,
  peekAutomationChatHost,
  type AutomationChatChannelReader,
  type AutomationChatHostContext,
} from "./chat-tools/context";
export { AUTOMATION_GUIDE_RECIPES, buildAutomationGuide } from "./chat-tools/guide";
export { createAutomationChatToolDefinitions } from "./chat-tools/tools";
export type * from "./types";
export type { SecretReader } from "./exec/types";

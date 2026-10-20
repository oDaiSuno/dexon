import type { AgentSessionLike } from "../../shared/pi-types";
import { SESSION_TOOL_NAMES, isSessionToolName } from "../../shared/session-orchestration";
import { browserCapabilityRuntime } from "../browser-capability-runtime";
import { browserToolNamesForSnapshot, isBrowserToolName } from "../browser-tools";

export function activateBrowserTools(inner: AgentSessionLike): void {
  const current = inner.getActiveToolNames().filter((name) => !isBrowserToolName(name));
  const browserTools = browserToolNamesForSnapshot(browserCapabilityRuntime.getSnapshot());
  inner.setActiveToolsByName([...new Set([...current, ...browserTools])]);
}

export function activateSessionTools(inner: AgentSessionLike, enabled: boolean): void {
  const current = inner.getActiveToolNames().filter((name) => !isSessionToolName(name));
  if (!enabled) {
    inner.setActiveToolsByName(current);
    return;
  }
  const available = new Set(inner.getAllTools().map((tool) => tool.name));
  inner.setActiveToolsByName([...new Set([...current, ...SESSION_TOOL_NAMES.filter((name) => available.has(name))])]);
}

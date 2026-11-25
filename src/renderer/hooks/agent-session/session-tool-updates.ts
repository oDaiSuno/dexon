import type { Dispatch, SetStateAction } from "react";
import type { AgentEvent, AgentPhase, LiveToolUpdate } from "./shared";

type UpdateTools = Dispatch<SetStateAction<ReadonlyMap<string, LiveToolUpdate>>>;
type UpdatePhase = Dispatch<SetStateAction<AgentPhase>>;

export function applyToolExecutionEvent(event: AgentEvent, setUpdates: UpdateTools, setPhase: UpdatePhase): void {
  const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
  if (!id) return;
  const name = typeof event.toolName === "string" ? event.toolName : undefined;
  const now = Date.now();
  setUpdates((current) => {
    const previous = current.get(id);
    if (event.type !== "tool_execution_start" && !previous) return current;
    if (previous?.endedAt !== undefined) return current;
    const update: LiveToolUpdate = {
      ...previous,
      toolCallId: id,
      toolName: name ?? previous?.toolName,
      startedAt: previous?.startedAt ?? now,
      ...(event.type === "tool_execution_update" ? { partialResult: event.partialResult } : {}),
      ...(event.type === "tool_execution_end"
        ? { partialResult: event.result ?? previous?.partialResult, endedAt: now, isError: event.isError === true }
        : {}),
    };
    return new Map(current).set(id, update);
  });
  if (event.type === "tool_execution_start") {
    setPhase((previous) => {
      const tools = previous?.kind === "running_tools" ? [...previous.tools] : [];
      if (!tools.some((tool) => tool.id === id)) tools.push({ id, name: name ?? "" });
      return { kind: "running_tools", tools };
    });
  } else if (event.type === "tool_execution_end") {
    setPhase((previous) => {
      if (previous?.kind !== "running_tools") return previous;
      const tools = previous.tools.filter((tool) => tool.id !== id);
      return tools.length > 0 ? { kind: "running_tools", tools } : { kind: "waiting_model" };
    });
  }
}

export function removeLiveToolUpdate(current: ReadonlyMap<string, LiveToolUpdate>, id: string) {
  if (!current.has(id)) return current;
  const next = new Map(current);
  next.delete(id);
  return next;
}

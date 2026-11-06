import { useCallback, useReducer } from "react";
import type { EnvironmentId } from "@contract/environment";
import { reduceFileTabState, type FileTab, type FileTabAction, type FileTabState } from "@/lib/file-tab-state";

type FileTabRequest =
  | Exclude<FileTabAction, { type: "open" }>
  | {
      type: "open";
      tab: Omit<FileTab, "environmentId"> & { environmentId?: EnvironmentId };
    };
const EMPTY: FileTabState = { tabs: [], activeTabId: "explorer" };

function reduceEnvironmentTabs(
  states: Map<EnvironmentId, FileTabState>,
  request: { environmentId: EnvironmentId; action: FileTabAction },
) {
  const current = states.get(request.environmentId) ?? EMPTY;
  const next = reduceFileTabState(current, request.action);
  if (next === current) return states;
  return new Map(states).set(request.environmentId, next);
}

export function useEnvironmentFileTabs(environmentId: EnvironmentId) {
  const [states, dispatch] = useReducer(reduceEnvironmentTabs, new Map<EnvironmentId, FileTabState>());
  const dispatchFileTab = useCallback(
    (action: FileTabRequest) => {
      if (action.type === "open") {
        const owner = action.tab.environmentId ?? environmentId;
        dispatch({ environmentId: owner, action: { ...action, tab: { ...action.tab, environmentId: owner } } });
      } else dispatch({ environmentId, action });
    },
    [environmentId],
  );
  const state = states.get(environmentId) ?? EMPTY;
  return { fileTabs: state.tabs, requestedTabId: state.activeTabId, dispatchFileTab };
}

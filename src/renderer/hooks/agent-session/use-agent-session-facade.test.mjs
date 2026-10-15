import assert from "node:assert/strict";
import test from "node:test";

import {
  createReadingSurface,
  createSessionDetail,
  createSessionHookHarness,
  createSessionTestHost,
} from "./session-hook-harness.mjs";

test("the public return shape of useAgentSession is stable for consumers", async (t) => {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, { bundleName: "facade-contract", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  const state = h.state;
  const expectedKeys = [
    // State
    "data",
    "loading",
    "error",
    "activeLeafId",
    "messages",
    "entryIds",
    "streamState",
    "agentRunning",
    "modelNames",
    "modelList",
    "modelCatalog",
    "modelRefreshing",
    "modelThinkingLevels",
    "modelThinkingLevelMaps",
    "newSessionModel",
    "thinkingLevel",
    "retryInfo",
    "contextUsage",
    "systemPrompt",
    "forkingEntryId",
    "isCompacting",
    "compactError",
    "compactResult",
    "currentModel",
    "displayModel",
    "sessionStats",
    "slashCommands",
    "slashCommandsLoading",
    "queuedMessages",
    "hasOlder",
    "loadingOlder",
    "historyRevision",
    "notices",
    "interactiveTools",
    "extensionStatuses",
    "extensionWidgets",
    "isAutoModelSelection",
    "agentPhase",
    "isNew",
    "isAwayFromBottom",
    "reattachAutoFollow",
    // Refs
    "sessionIdRef",
    "eventUnsubRef",
    "messagesEndRef",
    "liveContentEndRef",
    "scrollContainerRef",
    "lastUserMsgRef",
    "pendingScrollToUserRef",
    "initialScrollDoneRef",
    // Actions
    "handleSend",
    "handleAbort",
    "handleFork",
    "handleNavigate",
    "handleModelChange",
    "refreshModels",
    "cancelModelRefresh",
    "handleCompact",
    "handleSteer",
    "handleFollowUp",
    "handlePromptWithStreamingBehavior",
    "handleAbortCompaction",
    "handleRecallQueue",
    "handleBuiltinSlashCommand",
    "handleThinkingLevelChange",
    "loadSlashCommands",
    "loadOlder",
    "loadDeferredContent",
    "setActiveLeafId",
    "setData",
    "setMessages",
    "dispatch",
    "setAgentRunning",
    "setForkingEntryId",
    // Subscriptions
    "handleAgentEventRef",
  ];
  const missing = expectedKeys.filter((key) => !(key in state));
  const extra = Object.keys(state).filter((key) => !expectedKeys.includes(key));
  assert.deepEqual(missing, [], "no public key disappeared");
  assert.deepEqual(extra, [], "no undocumented public key appeared");
});

test("readingVisible flows through the facade to the reading branch", async (t) => {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail });
  const surface = createReadingSurface({ scrollTop: 0, scrollHeight: 400, clientHeight: 120 });
  const h = await createSessionHookHarness(t, {
    bundleName: "facade-reading",
    host,
    attach: (state) => {
      state.scrollContainerRef.current = surface.container;
    },
  });
  await h.mount({ session: detail.info, newSessionCwd: null, readingVisible: false });
  await h.flush();
  await h.act(() => surface.container.dispatch("scroll", {}));
  assert.equal(h.state.isAwayFromBottom, false, "hidden geometry is not treated as reading state");

  await h.update({ session: detail.info, newSessionCwd: null, readingVisible: true });
  await h.flush();
  assert.equal(h.state.isAwayFromBottom, true, "showing the page restores the real reading position");
  surface.container.scrollTop = 280;
  await h.act(() => surface.container.dispatch("scroll", {}));
  assert.equal(h.state.isAwayFromBottom, false, "visible scrolling updates the public reading state");
});

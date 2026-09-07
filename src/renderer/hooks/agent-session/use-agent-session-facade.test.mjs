import assert from "node:assert/strict";
import test from "node:test";

import { createSessionDetail, createSessionHookHarness, createSessionTestHost } from "./session-hook-harness.mjs";

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
  const h = await createSessionHookHarness(t, { bundleName: "facade-reading", host });
  await h.mount({ session: detail.info, newSessionCwd: null, readingVisible: false });
  await h.flush();
  assert.equal(h.env.windowListeners.get("keydown")?.length ?? 0, 0, "hidden facade keeps reading listeners off");

  await h.update({ session: detail.info, newSessionCwd: null, readingVisible: true });
  await h.flush();
  assert.ok(h.env.windowListeners.get("keydown")?.length > 0, "visible facade re-enables reading listeners");
});

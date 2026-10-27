import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";

const api = await loadRenderer(
  "session-model-switch-card",
  'export {SessionToolRow} from "./src/renderer/components/messages/session-tool-row.tsx";',
);
api.setAppLanguage("zh-CN");
after(restoreGlobals);

function setModelCall() {
  return {
    type: "toolCall",
    id: "call-switch",
    toolName: "session_set_model",
    input: {
      sessionId: "child-1",
      model: { provider: "held-fixture", modelId: "held-model-c" },
    },
  };
}

function setModelResult() {
  return {
    role: "toolResult",
    toolCallId: "call-switch",
    toolName: "session_set_model",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          sessionId: "child-1",
          previous: { model: { provider: "held-fixture", modelId: "held-model-b" }, thinkingLevel: "high" },
          current: { model: { provider: "held-fixture", modelId: "held-model-c" }, thinkingLevel: "high" },
        }),
      },
    ],
    isError: false,
    details: {
      targetSessionId: "child-1",
      modelSwitch: {
        from: { provider: "held-fixture", modelId: "held-model-b" },
        to: { provider: "held-fixture", modelId: "held-model-c" },
        thinkingLevel: "high",
      },
    },
  };
}

function refusedPromptCall() {
  return {
    type: "toolCall",
    id: "call-prompt",
    toolName: "session_prompt",
    input: { sessionId: "child-1", message: "把剩下的活干完", wait: true },
  };
}

function refusedPromptResult() {
  return {
    role: "toolResult",
    toolCallId: "call-prompt",
    toolName: "session_prompt",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          sessionId: "child-1",
          status: "error",
          stillRunning: false,
          error: "Model held-model-gone is unavailable for this session",
        }),
      },
    ],
    isError: false,
    details: {
      targetSessionId: "child-1",
      unavailableModel: { provider: "held-fixture", modelId: "held-model-gone" },
    },
  };
}

test(
  "when the Agent moved a worker to another model, the task card names the change of model",
  { timeout: 60_000 },
  async (t) => {
    const view = await mount(t, api.SessionToolRow, {
      block: setModelCall(),
      result: setModelResult(),
      duration: 320,
    });
    const card = view.container.textContent;
    assert.match(card, /切换模型/);
    assert.match(card, /held-model-b → held-model-c/);
  },
);

test(
  "when a task was refused because the worker's model is unavailable, the task card says which model has to be replaced",
  { timeout: 60_000 },
  async (t) => {
    const view = await mount(t, api.SessionToolRow, {
      block: refusedPromptCall(),
      result: refusedPromptResult(),
      duration: 320,
    });
    const card = view.container.textContent;
    assert.match(card, /失败/);
    assert.match(card, /模型 held-model-gone 不可用/);
  },
);

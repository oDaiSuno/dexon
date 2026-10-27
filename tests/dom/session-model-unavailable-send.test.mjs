import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  visibleText,
  click,
  act,
  dom,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";

after(restoreGlobals);

const SESSION = "personal-history";
const MODEL_ID = "held-model-gone";
const TYPED = "帮我把这段话润色一下";
const NOTICE = `模型 ${MODEL_ID} 不可用，请换一个模型再发送`;

const chat = (scene) => control(scene.container, "region", "聊天");
const composer = (scene) => control(chat(scene), "textbox");

async function type(element, value) {
  await act(async () => {
    element.focus();
    element.textContent = value;
    const range = dom.window.document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    element.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
}

test(
  "when the session's model is unavailable, sending is refused, the notice says which model to replace and the draft comes back",
  { timeout: 60_000 },
  async (t) => {
    const external = navigationBoundary({
      sessionOverrides: {
        [SESSION]: {
          model: { provider: "held-fixture", modelId: MODEL_ID },
          agentState: { running: false, state: { model: { provider: "held-fixture", id: MODEL_ID } } },
        },
      },
    });
    external.failures.agentPrompt = {
      sessionId: SESSION,
      code: "MODEL_UNAVAILABLE",
      message: `Model held-fixture/${MODEL_ID} is unavailable`,
      detail: { provider: "held-fixture", modelId: MODEL_ID },
    };
    const scene = await startNavigation(t, { language: "zh-CN", initialSession: SESSION }, external);
    await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));

    await type(composer(scene), TYPED);
    await click(control(chat(scene), "button", "发送"));

    await waitFor(() => visibleText(chat(scene), NOTICE));
    const sentence = visibleText(chat(scene), NOTICE);
    assert.equal(
      sentence.closest("[data-tone]")?.getAttribute("data-tone"),
      "error",
      "the sentence about the unavailable model is shown as an error notice",
    );
    assert.doesNotMatch(
      chat(scene).textContent,
      /is unavailable/,
      "the reader is not shown the Host's English message",
    );
    await waitFor(() => assert.equal(composer(scene).textContent, TYPED, "the typed message is back in the composer"));
    control(chat(scene), "button", MODEL_ID);
  },
);

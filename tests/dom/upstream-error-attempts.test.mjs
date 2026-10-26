import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";

const api = await loadRenderer(
  "upstream-error-attempts",
  'export {MessageView} from "./src/renderer/components/MessageView.tsx";',
);
api.setAppLanguage("zh-CN");
after(restoreGlobals);

function failure(extra = {}) {
  return {
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "503 upstream is overloaded",
    ...extra,
  };
}

function alertOf(view) {
  return view.container.querySelector('[role="alert"]');
}

test("when automatic retries run out, the failure card says retry failed and shows 3/3", async (t) => {
  const view = await mount(t, api.MessageView, { message: failure({ retry: { attempt: 3, maxAttempts: 3 } }) });
  const card = alertOf(view);
  assert.ok(card);
  assert.match(card.textContent, /重试失败/);
  assert.match(card.textContent, /3\/3/);
  assert.match(card.textContent, /upstream is overloaded/);
});

test("a failure that was never retried shows no attempt count", async (t) => {
  const view = await mount(t, api.MessageView, { message: failure() });
  const card = alertOf(view);
  assert.match(card.textContent, /请求失败/);
  assert.doesNotMatch(card.textContent, /\d+\/\d+/);
});

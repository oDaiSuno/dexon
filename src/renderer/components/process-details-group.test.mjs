import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createElement, click, loadRenderer, mount, restoreGlobals } from "../../../tests/support/renderer.mjs";

const { ProcessDetailsGroup, ThinkingExpansionStore, setAppLanguage } = await loadRenderer(
  "process-details-dom",
  'export {ProcessDetailsGroup} from "./src/renderer/components/ProcessDetailsGroup.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
setAppLanguage("en-US");
after(restoreGlobals);

function renderGroup(t, expansionStore, extraProps = {}) {
  return mount(t, ProcessDetailsGroup, {
    expansionStore,
    stateKey: "process-group:user-1:assistant-1",
    messageCount: 2,
    toolCallCount: 1,
    children: createElement("span", null, "persisted process content"),
    ...extraProps,
  });
}

test("process details show the whole-turn duration when it is available", async (t) => {
  const view = await renderGroup(t, new ThinkingExpansionStore(), { durationSeconds: 131 });
  assert.match(view.container.querySelector("button").textContent, /Processed 2m11s/);
});

test("process details show message and tool counts when no duration is available", async (t) => {
  const view = await renderGroup(t, new ThinkingExpansionStore());
  assert.match(view.container.querySelector("button").textContent, /Process details · 2 messages · 1 tool call\b/);
});

test("expanding process details survives remounting the same session without expanding another session", async (t) => {
  const sessionStore = new ThinkingExpansionStore();
  const first = await renderGroup(t, sessionStore);
  const toggle = first.container.querySelector("button");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.doesNotMatch(first.container.textContent, /persisted process content/);

  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.match(first.container.textContent, /persisted process content/);
  await first.unmount();

  const remounted = await renderGroup(t, sessionStore);
  assert.equal(remounted.container.querySelector("button").getAttribute("aria-expanded"), "true");
  assert.match(remounted.container.textContent, /persisted process content/);

  const otherSession = await renderGroup(t, new ThinkingExpansionStore());
  assert.equal(otherSession.container.querySelector("button").getAttribute("aria-expanded"), "false");
  assert.doesNotMatch(otherSession.container.textContent, /persisted process content/);
});

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, act, button, click, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
const { BranchNavigator } = await loadRenderer(
  "branch-navigation-behavior",
  'export {BranchNavigator} from "./src/renderer/components/BranchNavigator.tsx";',
);
after(restoreGlobals);
const props = { tree: [], activeLeafId: null, hasSession: true, inline: true, onLeafChange() {} };

test("inline branch navigation ignores inside presses and closes on Escape or outside presses", async (t) => {
  const view = await mount(t, BranchNavigator, props);
  const trigger = view.container.querySelector("button");
  await click(trigger);
  assert.match(view.container.textContent, /This session has no branches/);
  await act(async () => trigger.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
  assert.match(view.container.textContent, /This session has no branches/);
  await act(async () =>
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  assert.doesNotMatch(view.container.textContent, /This session has no branches/);
  await click(trigger);
  await act(async () => dom.window.document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
  assert.doesNotMatch(view.container.textContent, /This session has no branches/);
});

test("dismissal events stop reaching a removed controlled branch navigator", async (t) => {
  let dismissed = 0;
  const view = await mount(t, BranchNavigator, { ...props, open: true, onToggle: () => dismissed++ });
  await view.unmount();
  await act(async () => {
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    dom.window.document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  });
  assert.equal(dismissed, 0);
  void button;
});

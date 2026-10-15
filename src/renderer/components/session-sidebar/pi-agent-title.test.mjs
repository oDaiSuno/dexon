import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createManualScheduler } from "#test-timing";
import { act, click, loadRenderer, mount, restoreGlobals } from "../../../../tests/support/renderer.mjs";

const { PiAgentTitle } = await loadRenderer(
  "pi-agent-title-dom",
  'export {PiAgentTitle} from "./src/renderer/components/session-sidebar/pi-agent-title.tsx";',
  { define: { "import.meta.env.VITE_APP_VERSION": '"9.9.9"', "import.meta.env.VITE_PI_VERSION": '"0.84"' } },
);
after(restoreGlobals);

async function title(t) {
  const clock = createManualScheduler();
  const originals = new Map(
    ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  globalThis.setTimeout = clock.setTimeout;
  globalThis.clearTimeout = clock.clearTimeout;
  // Animation frames remain asynchronous and cancellable. Their number is not
  // a contract; the displayed text and post-unmount work are the observations.
  globalThis.requestAnimationFrame = (callback) => clock.setTimeout(() => callback(0), 16);
  globalThis.cancelAnimationFrame = clock.clearTimeout;
  let view;
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    }
  });
  view = await mount(t, PiAgentTitle);
  const control = view.container.querySelector("button");
  return {
    ...view,
    clock,
    control,
    async advanceUntil(text) {
      // A bounded wait for a visible outcome, not a copy of the scramble's
      // frame calculation. Changed animation implementations can settle sooner.
      for (let step = 0; step < 200 && control.textContent !== text; step++) {
        await act(async () => clock.runNext());
      }
      assert.equal(control.textContent, text);
    },
  };
}

test("clicking the title displays the configured versions and later returns to the app name", async (t) => {
  const view = await title(t);
  assert.equal(view.control.textContent, "Dexon");
  await click(view.control);
  await view.advanceUntil("9.9.9p0.84");
  await view.advanceUntil("Dexon");
});

for (const phase of ["animation", "version display"])
  test(`unmounting the title during ${phase} leaves no deferred browser work`, async (t) => {
    const view = await title(t);
    await click(view.control);
    if (phase === "version display") await view.advanceUntil("9.9.9p0.84");
    await view.unmount();
    assert.equal(view.container.isConnected, false);
    assert.equal(view.clock.pendingCount(), 0, "unmounted UI owns no remaining timers or animation frames");
  });

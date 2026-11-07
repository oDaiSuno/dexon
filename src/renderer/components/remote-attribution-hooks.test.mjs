import { attributionFixture, rootEl, restoreGlobals, createElement, act } from "./remote-attribution.harness.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";

after(restoreGlobals);

test("attribution subscribers settle and update when focus or connection changes", async (t) => {
  const f = await attributionFixture(t);
  function Readout() {
    const attribution = f.api.useSpaceAttribution();
    const gate = f.api.useSendGate();
    return createElement(
      "output",
      null,
      `${attribution.kind === "local" ? "Local" : attribution.label}|${gate.allowed}`,
    );
  }
  await f.render(Readout);
  assert.equal(rootEl.textContent, "Local|true");
  await f.focus();
  assert.equal(rootEl.textContent, "gpu-a100|true");
  await f.status({ phase: "offline", lastFailure: null });
  assert.equal(rootEl.textContent, "gpu-a100|false");
  await f.focus("remote-b");
  assert.equal(rootEl.textContent, "gpu-b200|true");
  await f.focus("primary");
  assert.equal(rootEl.textContent, "Local|true");
});

test("the clock ticks for mounted subscribers and releases all work after the last unmount", async (t) => {
  const active = new Set();
  const f = await attributionFixture(t, "", () => {
    const start = globalThis.setInterval;
    const stop = globalThis.clearInterval;
    t.mock.method(globalThis, "setInterval", (...args) => {
      const timer = start(...args);
      active.add(timer);
      return timer;
    });
    t.mock.method(globalThis, "clearInterval", (timer) => {
      active.delete(timer);
      stop(timer);
    });
  });
  function Clock() {
    return createElement("time", null, String(f.api.useNow()));
  }
  assert.equal(active.size, 0, "importing attribution must not start background work");
  await f.render(Clock);
  assert.equal(rootEl.textContent, "10000");
  await act(async () => t.mock.timers.tick(2_000));
  assert.equal(rootEl.textContent, "12000");
  await f.unmount();
  assert.equal(active.size, 0, "unmounting the last subscriber must release the clock");
  t.mock.timers.tick(5_000);
  await f.render(Clock);
  assert.equal(rootEl.textContent, "17000", "a new subscription must not reuse the old tick");
});

test("every unavailable remote state uses the same localized waiting gate", async (t) => {
  const f = await attributionFixture(t);
  function Gate() {
    const gate = f.api.useSendGate();
    return createElement("output", null, `${gate.allowed}|${gate.label}|${gate.hint}`);
  }
  await f.focus();
  await f.render(Gate);
  assert.equal(rootEl.textContent, "true||");
  for (const status of [
    { phase: "available" },
    { phase: "offline", lastFailure: null },
    { phase: "connecting", stage: "deploying", progress: 0.5, attempt: 1 },
    { phase: "backoff", retryAt: 10_000, failureCount: 2, reason: "network", detail: "lost" },
    { phase: "blocked", diagnosis: { reason: "configuration", detail: "Fix server settings" } },
  ]) {
    await f.status(status);
    assert.equal(rootEl.textContent, "false|Waiting to reconnect…|You can send after reconnecting", status.phase);
  }
  await f.push({ environments: [] });
  assert.equal(rootEl.textContent, "false|Waiting to reconnect…|You can send after reconnecting", "missing remote");
});

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createDeferred } from "#test-timing";
import { dom, act, click, button, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";
const api = await loadRenderer(
  "oauth-login-behavior",
  'export {ModelsConfig} from "./src/renderer/components/ModelsConfig.tsx";',
);
after(restoreGlobals);

async function models(t, cancel) {
  const starts = [];
  const streams = [];
  const host = installRendererApi(
    dom.window,
    api,
    () => ({
      call(method, params) {
        if (method === "modelsConfig.get") return { config: { providers: {} }, version: "fixture-v1" };
        if (method === "auth.providers")
          return {
            providers: [
              { id: "provider-a", name: "Provider A", loggedIn: true },
              { id: "provider-b", name: "Provider B", loggedIn: true },
            ],
          };
        if (method === "auth.allProviders") return { providers: [] };
        if (method === "models.preferences.get") return { enabledModels: null, models: [] };
        if (method === "models.defaults.get") return { model: null, thinkingLevel: "medium" };
        if (method === "auth.loginCancel") return Promise.resolve(cancel(params.provider)).then(() => ({ ok: true }));
        if (method === "auth.loginStart") {
          starts.push(params.provider);
          return { ok: true, started: true };
        }
        throw new Error(`unexpected model request: ${method}`);
      },
      subscribe(topic, provider) {
        assert.equal(topic, "auth.login");
        const stream = { provider, active: true };
        streams.push(stream);
        return () => {
          stream.active = false;
        };
      },
    }),
    { bridge: { openExternal: async () => {} } },
  );
  const view = await mount(
    t,
    api.ModelsConfig,
    { onClose() {}, embedded: true, cwd: "/workspace" },
    { release: host.close },
  );
  const select = (name) =>
    click([...view.container.querySelectorAll("span")].find((element) => element.textContent === name));
  await select("Provider A");
  return { view, starts, streams, select };
}

test("login waits for the previous attempt to stop before opening a new authorization stream", async (t) => {
  const pending = createDeferred();
  const { view, starts, streams } = await models(t, () => pending.promise);
  await click(button(view.container, "Re-login"));
  assert.deepEqual(starts, [], "the old login is still cancelling");
  assert.deepEqual(streams, [], "no authorization subscription opens before cancellation finishes");
  await act(async () => pending.resolve({}));
  assert.deepEqual(starts, ["provider-a"]);
  assert.ok(streams.some((stream) => stream.provider === "provider-a" && stream.active));
  await view.unmount();
  assert.ok(
    streams.every((stream) => !stream.active),
    "unmount releases the real authorization subscription",
  );
});

test("switching providers invalidates a waiting attempt without cancelling the new provider", async (t) => {
  const pending = createDeferred();
  const cancelled = [];
  const { view, starts, streams, select } = await models(t, (provider) => {
    cancelled.push(provider);
    return cancelled.length === 1 ? pending.promise : {};
  });
  await click(button(view.container, "Re-login"));
  await select("Provider B");
  await act(async () => pending.resolve({}));
  assert.deepEqual(starts, [], "the abandoned Provider A attempt cannot reopen");
  assert.ok(
    cancelled.every((provider) => provider === "provider-a"),
    "selecting B never cancels B's login",
  );
  await click(button(view.container, "Re-login"));
  assert.deepEqual(starts, ["provider-b"]);
  assert.ok(streams.some((stream) => stream.provider === "provider-b" && stream.active));
  await view.unmount();
  assert.ok(streams.every((stream) => !stream.active));
  assert.equal(cancelled.at(-1), "provider-b");
});

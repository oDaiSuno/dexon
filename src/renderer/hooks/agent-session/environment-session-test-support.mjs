import path from "node:path";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";
import { realRendererGraphOptions } from "../../components/renderer-real-graph.mjs";
import { createFolderBrowserHost } from "../../components/remote-folder-picker/folder-browser-test-helpers.mjs";
import { createSessionDetail, setupSessionHookEnvironment } from "./session-hook-harness.mjs";

export async function environmentSession(t) {
  const env = setupSessionHookEnvironment();
  const root = path.resolve(import.meta.dirname, "../../../..");
  const api = await importTestBundle(`environment-session-${t.name}`, {
    ...realRendererGraphOptions(root),
    stdin: {
      contents: `export {useAgentSession} from "./src/renderer/hooks/useAgentSession.ts";
        export {workspaceStore} from "./src/renderer/lib/workspace-store.ts";
        export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";`,
      resolveDir: root,
      loader: "ts",
    },
  });
  let detail = createSessionDetail("same-id");
  let runtime = { running: false, state: {} };
  let failSession = null;
  const host = await createFolderBrowserHost(api, {
    target: globalThis.window,
    reply(_id, method, params) {
      if (method === "sessions.get") {
        if (failSession) throw failSession;
        return { ...detail, agentState: runtime };
      }
      if (method === "sessions.context") return { context: detail.context };
      if (method === "agent.state") return runtime;
      if (method === "models.list") return { models: [], nameMap: {}, catalog: {}, defaultModel: null };
      if (method === "agent.command") {
        if (params.command.type === "extension_ui_response") return { id: params.command.id, status: "submitted" };
        return { leafId: "new-leaf", cancelled: false, newSessionId: "forked" };
      }
      throw new Error(`unexpected ${method}`);
    },
  });
  let restart;
  globalThis.window.piBridge.onHostRestarted = (listener) => {
    restart = listener;
    return () => {
      restart = null;
    };
  };
  api.environmentRegistry.initialize();
  await api.workspaceStore.openSpace({ environmentId: "staging", path: "/work/app" });
  api.environmentRegistry.registerSession("gpu", "same-id");
  api.environmentRegistry.registerSession("staging", "same-id");
  let state;
  let navigate;
  let renderer;
  function Probe() {
    state = api.useAgentSession({
      session: { ...detail.info, environmentId: "gpu" },
      newSessionCwd: null,
      onBranchDataChange: (_tree, _leaf, handler) => {
        navigate = handler;
      },
    });
    return null;
  }
  t.after(async () => {
    await act(async () => renderer?.unmount());
    host.close();
    env.restore();
  });
  await act(async () => {
    renderer = create(createElement(Probe));
  });
  const flush = async () => act(async () => new Promise((resolve) => setImmediate(resolve)));
  await flush();
  return {
    ...host,
    api,
    flush,
    act,
    navigate: (leaf) => navigate(leaf),
    get state() {
      return state;
    },
    setDetail(next) {
      detail = next;
    },
    setRuntime(next) {
      runtime = next;
    },
    failSession(error) {
      failSession = error;
    },
    restart: async () => act(async () => restart?.()),
  };
}

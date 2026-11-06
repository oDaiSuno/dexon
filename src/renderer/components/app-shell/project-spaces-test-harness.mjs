import path from "node:path";
import { importTestBundle } from "#test-bundle";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { createFolderBrowserHost } from "../remote-folder-picker/folder-browser-test-helpers.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");
export const api = await importTestBundle("navigation-project-spaces", {
  stdin: {
    contents: [
      'export { useProjectSpaces } from "./src/renderer/components/app-shell/use-project-spaces.ts";',
      'export { useEnvironmentDirectories } from "./src/renderer/components/session-sidebar/use-environment-directories.ts";',
      'export { useWorkspaceNavigation } from "./src/renderer/components/app-shell/use-workspace-navigation.ts";',
      'export { useSessionLocation } from "./src/renderer/components/app-shell/use-session-location.ts";',
      'export { useProjectWorkspace } from "./src/renderer/components/session-sidebar/project-workspace.ts";',
      'export { useSpaceCoordination } from "./src/renderer/components/app-shell/use-space-coordination.ts";',
      'export { resetRpc } from "./src/renderer/lib/api-client.ts";',
      'export { requestOpenSession } from "./src/renderer/lib/session-open-request.ts";',
      'export { workspaceStore } from "./src/renderer/lib/workspace-store.ts";',
      'export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";',
    ].join("\n"),
    resolveDir: root,
    sourcefile: "navigation-project-spaces-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(root, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(root),
});

export async function mountProjectProbe(t, hook, options = {}) {
  api.resetRpc();
  const host = await createFolderBrowserHost(api, options);
  let state;
  let renderer;
  function Probe(props) {
    state = hook(props);
    return null;
  }
  t.after(async () => {
    await act(async () => renderer?.unmount());
    api.resetRpc();
    host.close();
  });
  await act(async () => {
    renderer = create(createElement(Probe, options.props ?? {}));
  });
  return {
    ...host,
    get: () => state,
    update: async (props) => {
      await act(async () => renderer.update(createElement(Probe, props)));
    },
    run: async (action) => {
      await act(async () => action(api));
    },
  };
}

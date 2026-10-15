import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
import { createDeferredHost } from "../../../../tests/support/deferred-host.mjs";
import { importTestBundle } from "#test-bundle";
import path from "node:path";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Shared scaffolding for the plugin library hook tests: one esbuild bundle of
// the real hook, translation and communication client, deferred Host replies, and
// probe mounting helpers. Both use-plugin-library.test.mjs and
// use-plugin-library-update.test.mjs build on this module.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

export const { resetRpc, installApiShims, usePluginLibrary } = await importTestBundle("plugins-library", {
  stdin: {
    contents:
      'export { usePluginLibrary } from "./src/renderer/components/plugins/use-plugin-library.ts";' +
      '\nexport {resetRpc} from "./src/renderer/lib/api-client.ts"; export {installApiShims} from "./src/renderer/lib/api-fetch.ts";',
    resolveDir: projectRoot,
    sourcefile: "plugin-library-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
});

export function pkg(source, scope, overrides = {}) {
  return {
    source,
    scope,
    status: "loaded",
    disabled: false,
    packageName: source,
    version: "1.0.0",
    configuredVersion: "1.0.0",
    installedPath: `/home/tester/.pi/agent/${source}`,
    filtered: false,
    counts: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
    resources: [{ kind: "extension", name: "ext", path: "/x", relativePath: "./x" }],
    ...overrides,
  };
}

export function pluginsResponse(packagesList, extras = {}) {
  return {
    packages: packagesList,
    totals: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
    diagnostics: [],
    ...extras,
  };
}

const TIMED_GLOBALS = ["window", "IS_REACT_ACT_ENVIRONMENT"];

export function installEnvironment() {
  const originals = new Map(TIMED_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const deferredHost = createDeferredHost(["plugins.list", "plugins.set"]);
  const pending = deferredHost.pending;
  const sentCommands = [];
  let reloaded = 0;
  globalThis.__pluginLibraryHarness = {
    call: deferredHost.call,
    sendAgentCommand: (...args) => {
      sentCommands.push(args);
      return Promise.resolve();
    },
  };
  globalThis.window = { location: { href: "http://localhost/" }, localStorage: { getItem: () => null } };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const hostBoundary = installRendererApi(
    globalThis.window,
    { installApiShims, resetRpc },
    () => globalThis.__pluginLibraryHarness,
  );
  return {
    pending,
    sentCommands,
    onReloaded: () => {
      reloaded += 1;
    },
    reloadCount: () => reloaded,
    async restore() {
      try {
        hostBoundary.close();
      } finally {
        delete globalThis.__pluginLibraryHarness;
        for (const [name, descriptor] of originals) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else delete globalThis[name];
        }
      }
    },
  };
}

let activeProbeDisposers = null;

export function createProbe() {
  const state = { value: undefined };
  function Probe({ options }) {
    state.value = usePluginLibrary(options);
    return null;
  }
  return { state, Probe };
}

export async function mountProbe(Probe, options) {
  let renderer;
  let unmounted = false;
  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    await act(async () => {
      renderer?.unmount();
    });
  };
  // Register with the enclosing withEnvironment scope so a failed assertion
  // body still unmounts the probe before the environment is restored.
  activeProbeDisposers?.push(unmount);
  await act(async () => {
    renderer = create(createElement(Probe, { options }));
  });
  return {
    update: async (nextOptions) => {
      await act(async () => {
        renderer.update(createElement(Probe, { options: nextOptions }));
      });
    },
    unmount,
  };
}

export async function withEnvironment(run) {
  const env = installEnvironment();
  activeProbeDisposers = [];
  const errors = [];
  try {
    await run(env);
  } catch (error) {
    errors.push(error);
  }
  for (const dispose of activeProbeDisposers.reverse()) {
    try {
      await dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  activeProbeDisposers = null;
  try {
    await env.restore();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Plugin fixture and cleanup failed");
}

export async function loadWith(env, state, packagesList) {
  await act(async () => {
    env.pending[env.pending.length - 1].deferred.resolve(pluginsResponse(packagesList));
    await env.pending[env.pending.length - 1].deferred.promise.catch(() => {});
  });
  return state.value;
}

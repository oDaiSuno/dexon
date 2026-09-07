import { importTestBundle } from "#test-bundle";
import path from "node:path";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Shared scaffolding for the plugin library hook tests: one esbuild bundle of
// the real hook with stubbed i18n/agent-client, a deferred fetch harness, and
// probe mounting helpers. Both use-plugin-library.test.mjs and
// use-plugin-library-update.test.mjs build on this module.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

export const { usePluginLibrary } = await importTestBundle("plugins-library", {
  stdin: {
    contents: 'export { usePluginLibrary } from "./src/renderer/components/plugins/use-plugin-library.ts";',
    resolveDir: projectRoot,
    sourcefile: "plugin-library-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "plugins-library-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "plugins-library" }));
        build.onResolve({ filter: /(^|\/)agent-client$/ }, () => ({ path: "agent", namespace: "plugins-library" }));
        build.onLoad({ filter: /.*/, namespace: "plugins-library" }, ({ path: modulePath }) => ({
          contents:
            modulePath === "i18n"
              ? "function stubT(_key, fallback) { return fallback; }\n" +
                'export function useI18n() { return { language: "en", t: stubT }; }'
              : "export const sendAgentCommand = (...args) =>\n" +
                "  globalThis.__pluginLibraryHarness.sendAgentCommand(...args);",
          loader: "js",
        }));
      },
    },
  ],
});

export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

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

const TIMED_GLOBALS = ["fetch", "IS_REACT_ACT_ENVIRONMENT"];

export function installEnvironment() {
  const originals = new Map(TIMED_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const pending = [];
  const sentCommands = [];
  let reloaded = 0;
  globalThis.__pluginLibraryHarness = {
    sendAgentCommand: (...args) => {
      sentCommands.push(args);
      return Promise.resolve();
    },
  };
  globalThis.fetch = (url, options) => {
    const deferred = createDeferred();
    pending.push({ url, options, deferred });
    return deferred.promise;
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    pending,
    sentCommands,
    onReloaded: () => {
      reloaded += 1;
    },
    reloadCount: () => reloaded,
    async restore() {
      delete globalThis.__pluginLibraryHarness;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
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
  await act(async () => {
    renderer = create(createElement(Probe, { options }));
  });
  let unmounted = false;
  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    await act(async () => {
      renderer.unmount();
    });
  };
  // Register with the enclosing withEnvironment scope so a failed assertion
  // body still unmounts the probe before the environment is restored.
  activeProbeDisposers?.push(unmount);
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
  try {
    await run(env);
  } finally {
    for (const dispose of activeProbeDisposers) await dispose();
    activeProbeDisposers = null;
    await env.restore();
  }
}

export async function loadWith(env, state, packagesList) {
  await act(async () => {
    env.pending[env.pending.length - 1].deferred.resolve({
      ok: true,
      json: async () => pluginsResponse(packagesList),
    });
    await env.pending[env.pending.length - 1].deferred.promise;
  });
  return state.value;
}

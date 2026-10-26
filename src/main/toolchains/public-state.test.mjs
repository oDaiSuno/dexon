import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicToolchainState, selectDefaultCandidates } from "./public-state.ts";

const APP_DATA = { path: "/Users/li/Library/Application Support/Dexon", label: "$APP_DATA" };

function tool(capability, provider, executable, extra = {}) {
  return {
    id: `${capability}:${executable}`,
    capability,
    provider,
    discovery: "test",
    executable,
    argvPrefix: [],
    binDir: executable.slice(0, executable.lastIndexOf("/")),
    health: "healthy",
    rank: 1,
    ...extra,
  };
}

function publicState(candidates, options = {}) {
  return buildPublicToolchainState({
    revision: 1,
    platform: "darwin",
    arch: "arm64",
    candidates,
    defaults: selectDefaultCandidates(candidates, {}),
    preferences: {},
    redactionRoots: [APP_DATA],
    scanComplete: true,
    ...options,
  });
}

test("npm and npx from the same Node.js install follow Node.js, uvx from the same uv follows uv", () => {
  const state = publicState([
    tool("js.node", "system", "/opt/node/bin/node", { componentRoot: "/opt/node", version: "22.12.0" }),
    tool("js.npm", "system", "/opt/node/bin/node", {
      componentRoot: "/opt/node",
      argvPrefix: ["/opt/node/lib/node_modules/npm/bin/npm-cli.js"],
    }),
    tool("js.npx", "system", "/opt/node/bin/node", {
      componentRoot: "/opt/node",
      argvPrefix: ["/opt/node/lib/node_modules/npm/bin/npx-cli.js"],
    }),
    tool("python.uv", "system", "/opt/homebrew/bin/uv"),
    tool("python.uvx", "system", "/opt/homebrew/bin/uv", { argvPrefix: ["tool", "run"] }),
  ]);
  assert.equal(state.capabilities["js.npm"].follows, "js.node");
  assert.equal(state.capabilities["js.npx"].follows, "js.node");
  assert.equal(state.capabilities["python.uvx"].follows, "python.uv");
  assert.equal(state.capabilities["js.node"].follows, undefined);
  assert.equal(state.capabilities["python.uv"].follows, undefined);
});

test("an npm that comes from a different place than the chosen Node.js does not claim to follow it", () => {
  const state = publicState([
    tool("js.node", "managed", "/managed/node-lts/22.12.0/bin/node", { componentRoot: "/managed/node-lts/22.12.0" }),
    tool("js.npm", "legacy-upstream-managed", "/Users/li/.pi/npm/bin/npm"),
    tool("python.uvx", "system", "/usr/local/bin/uvx"),
  ]);
  assert.equal(state.capabilities["js.npm"].follows, undefined);
  assert.equal(state.capabilities["python.uvx"].follows, undefined, "uvx without a usable uv follows nothing");
});

test("the public state names the managed tools folder without revealing the full user path", () => {
  const managedRoot = "/Users/li/Library/Application Support/Dexon/toolchains";
  assert.equal(publicState([], { managedRoot }).managedRootLabel, "$APP_DATA/toolchains");
  assert.equal(publicState([]).managedRootLabel, undefined, "without a managed folder there is nothing to open");
});

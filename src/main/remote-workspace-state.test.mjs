import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateDesktopUiStatePatch } from "./ui-state-patch.ts";

const recoveredProjectSpaces = {
  version: 2,
  spaces: [{ environmentId: "gpu", path: "/code/recoverable" }],
  seeded: ["gpu"],
};

function savedUiState() {
  return {
    theme: "dark",
    sidebarWidth: 333,
    recentCwds: ["/code/remembered"],
    backgroundMode: false,
    window: { x: 30, y: 40, width: 1100, height: 750, isMaximized: false },
    chatAppearance: { fontSize: "large", layout: "wide" },
    openProjects: ["/code/legacy"],
    projectSpaces: {
      ...recoveredProjectSpaces,
      spaces: [...recoveredProjectSpaces.spaces, { environmentId: "", path: "/code/invalid" }],
    },
  };
}

async function persistedUiState(t, state) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dexon-remote-ui-state-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "ui-state.json");
  fs.writeFileSync(file, JSON.stringify(state));
  const api = await importTestBundle(
    "src/main/remote-workspace-state",
    {
      stdin: {
        contents: 'export { loadUiState, saveUiStateStrict, trackWindowState } from "./window-state.ts";',
        resolveDir: import.meta.dirname,
        loader: "ts",
      },
      plugins: [
        {
          name: "electron-user-data",
          setup(builder) {
            builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "ui-state-test" }));
            builder.onLoad({ filter: /.*/, namespace: "ui-state-test" }, () => ({
              contents: `export const app = { getPath() { return ${JSON.stringify(directory)}; } };`,
              loader: "js",
            }));
          },
        },
      ],
    },
    { registerCleanup: (cleanup) => t.after(cleanup) },
  );
  return { ...api, read: () => JSON.parse(fs.readFileSync(file, "utf8")) };
}

test("mounted remote spaces survive the UI state boundary without becoming local folders", () => {
  const projectSpaces = {
    version: 2,
    spaces: [{ environmentId: "gpu", path: "/home/ubuntu/work", displayPath: "~/work" }],
    seeded: ["gpu"],
  };
  assert.deepEqual(validateDesktopUiStatePatch({ projectSpaces }), { projectSpaces });
});

test("saving a theme preserves unrelated settings and valid remote spaces after a malformed saved row", async (t) => {
  const original = savedUiState();
  const state = await persistedUiState(t, original);
  state.saveUiStateStrict({ theme: "light" });
  const expected = { ...original, theme: "light", projectSpaces: recoveredProjectSpaces };
  assert.deepEqual(state.read(), expected);
  assert.deepEqual(state.loadUiState(), expected);
});

test("a window resize save preserves unrelated settings and valid remote spaces after a malformed saved row", async (t) => {
  const original = savedUiState();
  const state = await persistedUiState(t, original);
  const bounds = { x: 10, y: 20, width: 1200, height: 800 };
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isMinimized: () => false,
    isFullScreen: () => false,
    isMaximized: () => false,
    getNormalBounds: () => bounds,
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  state.trackWindowState(win);
  win.emit("resize");
  t.mock.timers.tick(400);
  const expected = {
    ...original,
    window: { ...bounds, isMaximized: false },
    projectSpaces: recoveredProjectSpaces,
  };
  assert.deepEqual(state.read(), expected);
  assert.deepEqual(state.loadUiState(), expected);
});

test("invalid saved appearance values do not discard other settings or recoverable remote spaces", async (t) => {
  const original = { ...savedUiState(), chatAppearance: { fontSize: "future", layout: "full" } };
  const state = await persistedUiState(t, original);
  const expected = {
    ...original,
    chatAppearance: { fontSize: "standard", layout: "wide" },
    projectSpaces: recoveredProjectSpaces,
  };
  assert.deepEqual(state.loadUiState(), expected);
  state.saveUiStateStrict({ theme: "light" });
  assert.deepEqual(state.read(), { ...expected, theme: "light" });
});

test("renderer UI state patches still reject malformed project spaces rather than recovering them", () => {
  for (const projectSpaces of [
    { ...recoveredProjectSpaces, spaces: [...recoveredProjectSpaces.spaces, { environmentId: "", path: "/bad" }] },
    {
      ...recoveredProjectSpaces,
      spaces: [
        { environmentId: "gpu", path: "C:\\Code\\App" },
        { environmentId: "gpu", path: "c:/code/app/" },
      ],
    },
    { ...recoveredProjectSpaces, spaces: null },
    { ...recoveredProjectSpaces, seeded: ["gpu", ""] },
    { ...recoveredProjectSpaces, lastFocusedSpace: { environmentId: "gpu", path: "relative" } },
    {
      ...recoveredProjectSpaces,
      spaces: Array.from({ length: 201 }, (_, i) => ({ environmentId: "gpu", path: `/code/${i}` })),
    },
    { ...recoveredProjectSpaces, seeded: Array.from({ length: 101 }, (_, i) => `environment-${i}`) },
  ])
    assert.throws(() => validateDesktopUiStatePatch({ projectSpaces }));
});

import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const appliedAtImport = [];
const borrowed = ["document", "localStorage", "window"];
const originals = new Map(borrowed.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

// 模块级导入时刻的平台面（theme-init 在 import 时同步应用主题，必须在加载前就位）。
// documentElement.style 保留可断言：colorScheme 同步是行为，不是源码形状。
const initialDocument = {
  documentElement: {
    classList: { toggle: (name, enabled) => appliedAtImport.push(["class", name, enabled]) },
    style: {},
  },
};
globalThis.document = initialDocument;
globalThis.localStorage = { getItem: () => null };
globalThis.window = { matchMedia: () => ({ matches: true }) };

const { initializeTheme, resolveInitialTheme } = await importTestBundle("src/renderer/theme-init", {
  packages: "external",
  entryPoints: [path.join(import.meta.dirname, "theme-init.ts")],
});

for (const [name, descriptor] of originals) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

test("module applies system dark mode synchronously before React mounts", () => {
  assert.deepEqual(appliedAtImport, [["class", "dark", true]]);
});

test("explicit persisted themes override the system and invalid values follow it", () => {
  assert.equal(resolveInitialTheme("light", true), "light");
  assert.equal(resolveInitialTheme("dark", false), "dark");
  assert.equal(resolveInitialTheme("system", true), "dark");
  assert.equal(resolveInitialTheme(null, false), "light");
});

test("initializer tolerates storage and media-query failures and always applies a theme", () => {
  const applied = [];
  const theme = initializeTheme({
    readStoredTheme: () => {
      throw new Error("storage blocked");
    },
    systemPrefersDark: () => {
      throw new Error("media query blocked");
    },
    applyTheme: (value) => applied.push(value),
  });
  assert.equal(theme, "light");
  assert.deepEqual(applied, ["light"]);
});

test("the import-time application synchronizes the color scheme together with the dark class", () => {
  assert.equal(initialDocument.documentElement.style.colorScheme, "dark");
});

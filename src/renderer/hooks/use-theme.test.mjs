import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import {
  dom,
  createElement,
  loadRenderer,
  mount,
  click,
  button,
  restoreGlobals,
} from "../../../tests/support/renderer.mjs";

const { useTheme } = await loadRenderer(
  "document-theme-behavior",
  'export {useTheme} from "./src/renderer/hooks/useTheme.ts";',
);
after(restoreGlobals);
beforeEach(() => {
  dom.window.localStorage.clear();
  dom.window.document.documentElement.classList.remove("dark");
  dom.window.document.documentElement.style.colorScheme = "";
});
function ThemeControls() {
  const { theme, toggleTheme } = useTheme();
  return createElement(
    "div",
    null,
    createElement("output", null, theme),
    createElement("button", { onClick: () => toggleTheme() }, "Toggle theme"),
  );
}
test("a fresh document follows the light system theme", async (t) => {
  const view = await mount(t, ThemeControls);
  assert.equal(view.container.querySelector("output").textContent, "light");
  assert.equal(dom.window.document.documentElement.classList.contains("dark"), false);
  assert.equal(dom.window.document.documentElement.style.colorScheme, "light");
});
test("toggling synchronizes the rendered theme, document colors and saved preference", async (t) => {
  const view = await mount(t, ThemeControls);
  await click(button(view.container, "Toggle theme"));
  assert.equal(view.container.querySelector("output").textContent, "dark");
  assert.equal(dom.window.document.documentElement.classList.contains("dark"), true);
  assert.equal(dom.window.document.documentElement.style.colorScheme, "dark");
  assert.equal(dom.window.localStorage.getItem("pi-theme"), "dark");
  await click(button(view.container, "Toggle theme"));
  assert.equal(view.container.querySelector("output").textContent, "light");
  assert.equal(dom.window.document.documentElement.classList.contains("dark"), false);
  assert.equal(dom.window.document.documentElement.style.colorScheme, "light");
  assert.equal(dom.window.localStorage.getItem("pi-theme"), "light");
});

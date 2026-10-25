import assert from "node:assert/strict";
import test from "node:test";

import { isBrowserDevToolsShortcut } from "./browser-devtools-shortcut.ts";

function input(key, modifiers = {}) {
  return { key, control: false, meta: false, shift: false, alt: false, ...modifiers };
}

test("F12, ⌥⌘I and Ctrl+Shift+I are the DevTools shortcuts the built-in browser blocks", () => {
  const shortcuts = [
    input("F12"),
    input("i", { meta: true, alt: true }),
    input("I", { meta: true, alt: true }),
    input("i", { control: true, shift: true }),
    input("I", { control: true, shift: true }),
  ];

  for (const shortcut of shortcuts) assert.equal(isBrowserDevToolsShortcut(shortcut), true);
});

test("⌘J and the other former DevTools combinations reach the page and the app menu", () => {
  const allowed = [
    input("j", { meta: true }),
    input("j", { control: true }),
    input("j", { meta: true, alt: true }),
    input("J", { meta: true, shift: true }),
    input("J", { control: true, shift: true }),
    input("c", { meta: true, alt: true }),
    input("C", { control: true, shift: true }),
    input("I", { meta: true, shift: true }),
    input("i", { control: true }),
    input("c", { control: true }),
    input("r", { control: true, shift: true }),
    input("i", { alt: true }),
    input("x", { meta: true, alt: true }),
  ];

  for (const shortcut of allowed) assert.equal(isBrowserDevToolsShortcut(shortcut), false);
});

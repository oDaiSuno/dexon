import assert from "node:assert/strict";
import test from "node:test";

import { APP_MONO_FONT_FAMILY, APP_SANS_FONT_FAMILY } from "./font-stack.ts";
import { readStylePartial } from "../renderer/styles/css-sources.mjs";

function cssCustomProperty(source, property) {
  const match = source.match(new RegExp(`${property}:\\s*([^;]+);`));
  assert.ok(match, `Missing ${property}`);
  return match[1].replace(/\s+/g, " ").trim();
}

test("renderer CSS uses the shared system and CJK font stacks", () => {
  const css = readStylePartial("tokens.css");

  assert.equal(cssCustomProperty(css, "--font-sans"), APP_SANS_FONT_FAMILY);
  assert.equal(cssCustomProperty(css, "--font-mono"), APP_MONO_FONT_FAMILY);
  assert.match(APP_SANS_FONT_FAMILY, /Microsoft YaHei/);
  assert.match(APP_SANS_FONT_FAMILY, /PingFang SC/);
  assert.match(APP_SANS_FONT_FAMILY, /Noto Sans CJK SC/);
});

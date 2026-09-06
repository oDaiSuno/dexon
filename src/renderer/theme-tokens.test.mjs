import assert from "node:assert/strict";
import test from "node:test";
import { readRendererCssSources } from "./styles/css-sources.mjs";

const css = readRendererCssSources();

test("removed unused theme tokens stay out of the global contract", () => {
  for (const token of [
    "--font-mono-font",
    "--font-sans-font",
    "--font-size-caption",
    "--font-size-control",
    "--font-size-body",
    "--control-height-compact",
  ]) {
    assert.doesNotMatch(css, new RegExp(token), token);
  }
});

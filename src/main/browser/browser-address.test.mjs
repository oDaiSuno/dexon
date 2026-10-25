import assert from "node:assert/strict";
import test from "node:test";

import { resolveBrowserAddress } from "./browser-address.ts";

const bing = { searchEngine: "bing", customSearchTemplate: "" };
const google = { searchEngine: "google", customSearchTemplate: "" };

test("typed words that do not look like an address open a search with the chosen engine", () => {
  assert.equal(resolveBrowserAddress("dexon browser", bing), "https://www.bing.com/search?q=dexon%20browser");
  assert.equal(resolveBrowserAddress("dexon", bing), "https://www.bing.com/search?q=dexon");
  assert.equal(resolveBrowserAddress("  what is dexon ", google), "https://www.google.com/search?q=what%20is%20dexon");
});

test("typed text that looks like an address is opened as a site, not searched", () => {
  assert.equal(resolveBrowserAddress("example.com", bing), "https://example.com");
  assert.equal(resolveBrowserAddress("docs.example.com/guide?a=1", bing), "https://docs.example.com/guide?a=1");
  assert.equal(resolveBrowserAddress("localhost:3000", bing), "https://localhost:3000");
  assert.equal(resolveBrowserAddress("localhost", bing), "https://localhost");
  assert.equal(resolveBrowserAddress("192.168.1.10", bing), "https://192.168.1.10");
  assert.equal(resolveBrowserAddress("https://example.com/a", bing), "https://example.com/a");
  assert.equal(resolveBrowserAddress("http://example.com", bing), "http://example.com");
  assert.equal(resolveBrowserAddress("about:blank", bing), "about:blank");
});

test("an Agent address is never turned into a search", () => {
  assert.equal(resolveBrowserAddress("dexon", null), "https://dexon");
  assert.equal(resolveBrowserAddress("example.com", null), "https://example.com");
});

test("an empty or multi-line address is still rejected", () => {
  assert.throws(
    () => resolveBrowserAddress("   ", bing),
    (error) => error.code === "INVALID_BROWSER_REQUEST",
  );
  assert.throws(
    () => resolveBrowserAddress("a\nb", bing),
    (error) => error.code === "INVALID_BROWSER_REQUEST",
  );
});

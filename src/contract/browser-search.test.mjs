import assert from "node:assert/strict";
import test from "node:test";

import { browserSearchUrl } from "./browser-search.ts";

const navigation = (searchEngine, customSearchTemplate = "") => ({ searchEngine, customSearchTemplate });

test("each built-in search engine turns typed words into its search page address", () => {
  assert.equal(browserSearchUrl(navigation("bing"), "dexon browser"), "https://www.bing.com/search?q=dexon%20browser");
  assert.equal(
    browserSearchUrl(navigation("google"), "dexon browser"),
    "https://www.google.com/search?q=dexon%20browser",
  );
  assert.equal(
    browserSearchUrl(navigation("duckduckgo"), "dexon browser"),
    "https://duckduckgo.com/?q=dexon%20browser",
  );
  assert.equal(browserSearchUrl(navigation("baidu"), "dexon browser"), "https://www.baidu.com/s?wd=dexon%20browser");
});

test("a custom search address receives the typed words, safely encoded, in place of {query}", () => {
  assert.equal(
    browserSearchUrl(navigation("custom", "https://search.example/find?term={query}&lang=en"), "a&b=c 中文"),
    "https://search.example/find?term=a%26b%3Dc%20%E4%B8%AD%E6%96%87&lang=en",
  );
});

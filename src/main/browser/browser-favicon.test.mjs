import assert from "node:assert/strict";
import test from "node:test";

import { faviconDataUrl, pickFaviconUrl } from "./browser-favicon.ts";

test("the first web address among the page's icons is the one to load", () => {
  assert.equal(
    pickFaviconUrl([
      "javascript:alert(1)",
      "file:///etc/icon.png",
      "https://site.test/favicon.ico",
      "https://site.test/b.png",
    ]),
    "https://site.test/favicon.ico",
  );
  assert.equal(pickFaviconUrl(["http://site.test/icon.png"]), "http://site.test/icon.png");
});

test("icons that are not plain web addresses are ignored", () => {
  assert.equal(pickFaviconUrl([]), null);
  assert.equal(pickFaviconUrl(["https://user:secret@site.test/favicon.ico"]), null);
  assert.equal(pickFaviconUrl(["data:image/png;base64,AQID", "not a url"]), null);
  assert.equal(pickFaviconUrl([`https://site.test/${"a".repeat(2_100)}.ico`]), null);
});

test("a downloaded image becomes an inline picture, anything else is dropped", () => {
  assert.equal(faviconDataUrl("image/png", Buffer.from([1, 2, 3])), "data:image/png;base64,AQID");
  assert.equal(faviconDataUrl("image/x-icon; charset=binary", Buffer.from([1, 2, 3])), "data:image/x-icon;base64,AQID");
  assert.equal(faviconDataUrl("text/html", Buffer.from([1, 2, 3])), null);
  assert.equal(faviconDataUrl(null, Buffer.from([1, 2, 3])), null);
  assert.equal(faviconDataUrl("image/png", Buffer.alloc(0)), null);
});

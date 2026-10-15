import assert from "node:assert/strict";
import test from "node:test";

import { readSessionIdFromSearch, routerCompat } from "./router-compat.ts";

test("router object and replace method retain module-level identity", () => {
  const firstRouter = routerCompat;
  const firstReplace = routerCompat.replace;

  assert.equal(routerCompat, firstRouter);
  assert.equal(routerCompat.replace, firstReplace);
  assert.equal(Object.isFrozen(routerCompat), true);
});

test("router replacement preserves pathname query navigation semantics", () => {
  const originalWindow = globalThis.window;
  const replacements = [];
  const events = [];
  globalThis.window = {
    location: { pathname: "/desktop" },
    history: {
      replaceState(_state, _title, url) {
        replacements.push(url);
      },
    },
    dispatchEvent(event) {
      events.push(event.type);
    },
  };

  try {
    routerCompat.replace("session=abc");
    routerCompat.replace("/");
  } finally {
    globalThis.window = originalWindow;
  }

  assert.deepEqual(replacements, ["/desktop?session=abc", "/"]);
  assert.deepEqual(events, ["popstate", "popstate"]);
});

test("initial session id parsing handles present and absent values", () => {
  assert.equal(readSessionIdFromSearch("?session=a%2Fb&view=chat"), "a/b");
  assert.equal(readSessionIdFromSearch("?view=chat"), null);
});

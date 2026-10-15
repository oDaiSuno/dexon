import assert from "node:assert/strict";
import test from "node:test";

import { directoryRefreshAction, shouldLoadDirectoryOnExpand } from "./directory-refresh.ts";

test("a loaded collapsed directory becomes stale and reloads on its next expansion", () => {
  assert.equal(directoryRefreshAction(false, true), "mark-stale");
  assert.equal(shouldLoadDirectoryOnExpand(false, true), true);
});

test("an open loaded directory refreshes immediately", () => {
  assert.equal(directoryRefreshAction(true, true), "reload");
  assert.equal(directoryRefreshAction(true, false), "none");
});

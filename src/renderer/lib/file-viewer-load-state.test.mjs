import assert from "node:assert/strict";
import test from "node:test";

import { INITIAL_TEXT_FILE_LOAD_STATE, textFileLoadReducer } from "./file-viewer-load-state.ts";

const first = { content: "first", language: "text", size: 5 };
const second = { content: "second", language: "text", size: 6 };

test("a successful load structurally clears an earlier error", () => {
  const failed = textFileLoadReducer(INITIAL_TEXT_FILE_LOAD_STATE, { type: "failed", error: "missing" });
  assert.deepEqual(failed, { status: "error", data: null, error: "missing" });

  const recovered = textFileLoadReducer(failed, { type: "succeeded", data: first });
  assert.deepEqual(recovered, { status: "ready", data: first, error: null });
});

test("a later load replaces the shown content without keeping the earlier text", () => {
  const loaded = textFileLoadReducer(INITIAL_TEXT_FILE_LOAD_STATE, { type: "succeeded", data: first });
  const refreshed = textFileLoadReducer(loaded, { type: "succeeded", data: second });
  assert.deepEqual(refreshed, { status: "ready", data: second, error: null });
});

test("reset removes every prior terminal state", () => {
  const loaded = textFileLoadReducer(INITIAL_TEXT_FILE_LOAD_STATE, { type: "succeeded", data: first });
  assert.equal(textFileLoadReducer(loaded, { type: "reset" }), INITIAL_TEXT_FILE_LOAD_STATE);
});

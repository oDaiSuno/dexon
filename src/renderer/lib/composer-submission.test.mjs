import assert from "node:assert/strict";
import test from "node:test";

import {
  captureComposerSubmission,
  failedComposerSubmissionAction,
  failedComposerSubmissionValue,
} from "./composer-submission.ts";

test("composer snapshots capture the raw value including token references", () => {
  const snapshot = captureComposerSubmission('look at @/tmp/pi-clipboard-a.png and @"my dir/notes.md"');
  assert.equal(snapshot.value, 'look at @/tmp/pi-clipboard-a.png and @"my dir/notes.md"');
  assert.equal(failedComposerSubmissionValue(snapshot), snapshot.value);
});

test("submission restore only applies when the input did not change meanwhile", () => {
  assert.equal(failedComposerSubmissionAction(3, 3), "restore");
  assert.equal(failedComposerSubmissionAction(3, 4), "preserve");
});

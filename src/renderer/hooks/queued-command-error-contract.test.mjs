import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hookSource = readFileSync(new URL("./agent-session/use-session-queue.ts", import.meta.url), "utf8");
const inputSource = readFileSync(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
const inputTypesSource = readFileSync(new URL("../components/chat-input/types.ts", import.meta.url), "utf8");

test("queued command handlers notify and reject on command failures", () => {
  for (const [logMessage, translationKey] of [
    ["Failed to steer:", "steerFailedNotQueued"],
    ["Failed to queue prompt:", "promptQueueFailedNotQueued"],
    ["Failed to follow up:", "followUpQueueFailedNotQueued"],
  ]) {
    const logIndex = hookSource.indexOf(`console.error("${logMessage}", error);`);
    assert.notEqual(logIndex, -1);
    const rejectionBlock = hookSource.slice(logIndex, hookSource.indexOf("throw error;", logIndex) + 12);
    assert.match(rejectionBlock, new RegExp(`t\\("${translationKey}"`));
    assert.match(rejectionBlock, /addNotice\(\{[\s\S]*?type: "error"/);
  }
});

test("queued command handlers reject a missing-session race", () => {
  assert.equal(
    (hookSource.match(/const error = new Error\("The active session is no longer available"\)/g) ?? []).length,
    3,
  );
  assert.equal((hookSource.match(/throw error;/g) ?? []).length >= 6, true);
});

test("ChatInput queues token references as plain text, awaits handlers, and restores rejected snapshots", () => {
  assert.match(inputTypesSource, /onSteer\?:[\s\S]*?Promise<void> \| void/);
  assert.match(inputTypesSource, /onFollowUp\?:[\s\S]*?Promise<void> \| void/);
  // Attachment tokens are literal text, so streaming queues accept them.
  assert.doesNotMatch(inputSource, /queuedImagesUnsupported/);
  assert.match(inputSource, /await Promise\.resolve\(onSteer\(message\)\)/);
  assert.match(inputSource, /await Promise\.resolve\(onFollowUp\(message\)\)/);
  assert.match(inputSource, /catch \{\s*restoreFailedSubmission\(snapshot, clearedAtRevision, "queue"\)/);
});

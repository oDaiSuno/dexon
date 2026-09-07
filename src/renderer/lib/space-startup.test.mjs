import assert from "node:assert/strict";
import test from "node:test";

import { parseStoredSpaceCwd, resolveStartupSpace } from "./space-startup.ts";

test("startup space waits while the stored preference has not been read", () => {
  assert.deepEqual(
    resolveStartupSpace({ sessionIntent: null, sessionResolved: true, sessionFound: false, storedSpaceCwd: undefined }),
    { type: "wait" },
  );
});

test("startup space restores the stored directory immediately without an explicit session", () => {
  // No URL session intent: the decision must not wait for the session list at
  // all — even before the list has resolved (sessionResolved = false).
  assert.deepEqual(
    resolveStartupSpace({ sessionIntent: null, sessionResolved: false, sessionFound: false, storedSpaceCwd: "/last" }),
    { type: "restore", path: "/last" },
  );
  assert.deepEqual(
    resolveStartupSpace({ sessionIntent: null, sessionResolved: true, sessionFound: false, storedSpaceCwd: "/last" }),
    { type: "restore", path: "/last" },
  );
});

test("startup space prepares the personal space on first run without an explicit session", () => {
  assert.deepEqual(
    resolveStartupSpace({ sessionIntent: null, sessionResolved: false, sessionFound: false, storedSpaceCwd: null }),
    { type: "personal" },
  );
  assert.deepEqual(
    resolveStartupSpace({ sessionIntent: null, sessionResolved: true, sessionFound: false, storedSpaceCwd: null }),
    { type: "personal" },
  );
});

test("startup space waits while an explicit session link is unresolved", () => {
  // HC-2: a loading or failed session list does not mean the session is gone.
  assert.deepEqual(
    resolveStartupSpace({ sessionIntent: "s1", sessionResolved: false, sessionFound: false, storedSpaceCwd: "/last" }),
    { type: "wait" },
  );
  assert.deepEqual(
    resolveStartupSpace({ sessionIntent: "s1", sessionResolved: false, sessionFound: false, storedSpaceCwd: null }),
    { type: "wait" },
  );
});

test("startup space defers to the explicit session once it is found", () => {
  assert.deepEqual(
    resolveStartupSpace({ sessionIntent: "s1", sessionResolved: true, sessionFound: true, storedSpaceCwd: "/last" }),
    { type: "explicit" },
  );
  assert.deepEqual(
    resolveStartupSpace({ sessionIntent: "s1", sessionResolved: true, sessionFound: true, storedSpaceCwd: null }),
    { type: "explicit" },
  );
});

test("startup space falls back to the space tiers after the explicit session is confirmed absent", () => {
  assert.deepEqual(
    resolveStartupSpace({ sessionIntent: "s1", sessionResolved: true, sessionFound: false, storedSpaceCwd: "/last" }),
    { type: "restore", path: "/last" },
  );
  assert.deepEqual(
    resolveStartupSpace({ sessionIntent: "s1", sessionResolved: true, sessionFound: false, storedSpaceCwd: null }),
    { type: "personal" },
  );
});

test("stored space parsing keeps valid paths and normalizes garbage shapes to no record", () => {
  assert.equal(parseStoredSpaceCwd("/Users/tester/.dexon"), "/Users/tester/.dexon");
  assert.equal(parseStoredSpaceCwd("C:\\Users\\tester\\.dexon"), "C:\\Users\\tester\\.dexon");
  assert.equal(parseStoredSpaceCwd("C:/Users/tester/.dexon"), "C:/Users/tester/.dexon");
  assert.equal(parseStoredSpaceCwd("\\\\server\\share\\space"), "\\\\server\\share\\space");

  // Relative shapes must never become a restorable space — they would resolve
  // against whatever directory a process happens to run in.
  assert.equal(parseStoredSpaceCwd("."), null);
  assert.equal(parseStoredSpaceCwd(".."), null);
  assert.equal(parseStoredSpaceCwd("relative/path"), null);

  assert.equal(parseStoredSpaceCwd(""), null);
  assert.equal(parseStoredSpaceCwd(42), null);
  assert.equal(parseStoredSpaceCwd(null), null);
  assert.equal(parseStoredSpaceCwd(undefined), null);
  assert.equal(parseStoredSpaceCwd({ path: "/x" }), null);
  assert.equal(parseStoredSpaceCwd("has\0null"), null);
  assert.equal(parseStoredSpaceCwd("has\nnewline"), null);
  assert.equal(parseStoredSpaceCwd("has\rcarriage"), null);
  assert.equal(parseStoredSpaceCwd(`/${"a".repeat(4096)}`), null);
});

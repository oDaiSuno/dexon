import assert from "node:assert/strict";
import test from "node:test";
import { findDesktopDeepLink, parseDesktopDeepLink } from "./deep-link.ts";

test("parses desktop session links with case-insensitive schemes", () => {
  assert.deepEqual(parseDesktopDeepLink("dexon://session/session-one"), { sessionId: "session-one" });
  assert.deepEqual(parseDesktopDeepLink("DEXON://SESSION/session-two"), { sessionId: "session-two" });
  assert.deepEqual(parseDesktopDeepLink("dexon:///session/session-three"), {
    sessionId: "session-three",
  });
});

test("finds only a valid desktop deep link in second-instance argv", () => {
  assert.equal(
    findDesktopDeepLink(["dexon", "--flag", "DEXON://SESSION/windows-session"]),
    "DEXON://SESSION/windows-session",
  );
  assert.equal(
    findDesktopDeepLink(["dexon", "https://example.test/session/secret", "dexon://bad"]),
    undefined,
  );
  assert.equal(parseDesktopDeepLink("dexon://session"), null);
});

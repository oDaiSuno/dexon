import assert from "node:assert/strict";
import test from "node:test";
import { validateDesktopUiStatePatch } from "./ui-state-patch.ts";

test("mounted remote spaces survive the UI state boundary without becoming local folders", () => {
  const projectSpaces = {
    version: 2,
    spaces: [{ environmentId: "gpu", path: "/home/ubuntu/work", displayPath: "~/work" }],
    seeded: ["gpu"],
  };
  assert.deepEqual(validateDesktopUiStatePatch({ projectSpaces }), { projectSpaces });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./settings/general-settings.tsx", import.meta.url), "utf8");
const softwareUpdateSource = readFileSync(new URL("./settings/software-update.tsx", import.meta.url), "utf8");

test("background mode load failures are consumed and leave a visible error", () => {
  assert.match(source, /getUiState\(\)[\s\S]*?\.catch\(\(\) => \{[\s\S]*?setBackgroundModeError\("load"\)/);
  assert.match(source, /\.finally\(\(\) => \{[\s\S]*?setBackgroundModeLoading\(false\)/);
  assert.match(source, /return \(\) => \{\s*disposed = true/);
});

test("background mode save failures roll back and report the failure", () => {
  assert.match(source, /const previous = backgroundMode;[\s\S]*?setBackgroundMode\(next\)/);
  assert.match(
    source,
    /await window\.piBridge\.setUiState\(\{ backgroundMode: next \}\);[\s\S]*?catch \{\s*setBackgroundMode\(previous\);\s*setBackgroundModeError\("save"\)/,
  );
  assert.match(source, /disabled=\{backgroundModeLoading \|\| backgroundModeSaving\}/);
  assert.match(source, /backgroundModeError && \([\s\S]*?role="alert"/);
});

test("automatic update checks commit only the state returned by the existing action path", () => {
  assert.match(softwareUpdateSource, /checked=\{state\?\.automaticChecksEnabled \?\? false\}/);
  assert.match(
    softwareUpdateSource,
    /void performAction\("automatic", async \(\) => \{\s*const nextState = await window\.piBridge\.setAutomaticUpdateChecks\(enabled\);\s*setState\(nextState\)/,
  );
  assert.doesNotMatch(softwareUpdateSource, /setState\(\{[\s\S]*?automaticChecksEnabled: enabled/);
});

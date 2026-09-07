import assert from "node:assert/strict";
import test, { after } from "node:test";

// Present-descriptor restoration contract for the shared DOM fixture. This
// file must define the pre-existing property BEFORE importing the fixture so
// the fixture's import-time snapshot captures it; it runs in its own test
// process, so the fixture has never been evaluated before this point.

const PRETEST_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
const PRIOR_DESCRIPTOR = {
  configurable: true,
  writable: true,
  enumerable: false,
  value: "custom-prior-value",
};
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", PRIOR_DESCRIPTOR);

const { installDomEnvironment, restoreGlobals } = await import("./resource-dom-environment.mjs");

after(() => {
  // The fixture restores ITS pre-import snapshot (the sentinel); this file
  // must then restore the state that existed before the file itself ran.
  restoreGlobals();
  if (PRETEST_DESCRIPTOR) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", PRETEST_DESCRIPTOR);
  else delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

test("installDomEnvironment overwrites a pre-existing property", () => {
  assert.equal(globalThis.IS_REACT_ACT_ENVIRONMENT, true);
});

test("restoreGlobals restores the exact pre-import descriptor and value", () => {
  restoreGlobals();
  const restored = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  assert.ok(restored, "a pre-existing property must be restored, not deleted");
  assert.equal(restored.value, "custom-prior-value");
  assert.equal(restored.writable, true);
  assert.equal(restored.enumerable, false);
  assert.equal(restored.configurable, true);

  // Globals that were absent before this file's import stay absent.
  for (const name of ["window", "document", "HTMLElement", "Node"]) {
    assert.equal(Object.hasOwn(globalThis, name), false, `${name} must be deleted when absent before import`);
  }
  installDomEnvironment();
});

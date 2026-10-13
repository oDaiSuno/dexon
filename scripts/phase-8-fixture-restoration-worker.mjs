// target: scripts/phase-8-fixture-restoration-worker.mjs
// Contract: spec §3.4 / plan §2.7 / ASTRA-R10-F001; real Node hooks, no substitute cleanup.
// Expected failure features: RESTORATION_CONTRACT:fetch / RESTORATION_CONTRACT:navigator.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  faultWitness,
  installInstrumentation,
  interrupt,
  isInjected,
  registerFinalHooks,
  runRegisteredCallback,
} from "./phase-8-fixture-instrumentation.mjs";
import {
  captureDescriptors,
  descriptorDifferences,
  emergencyRestore,
  observeFollowingFixture,
} from "./phase-8-fixture-descriptors.mjs";

const config = JSON.parse(process.env.PHASE8_FIXTURE_CASE);
const target = pathToFileURL(path.resolve(config.file)).href;
const followingUrl = pathToFileURL(path.resolve("src/renderer/components/chat-window-composition.harness.mjs")).href;
const originalClearTimeout = clearTimeout;
const watchdog = setTimeout(() => {
  console.error("PROCESS_BOUNDARY:worker watchdog");
  process.exit(124);
}, 25000);
watchdog.unref();

if (config.ambient === "absent") delete globalThis.fetch;
if (config.ambient === "custom") {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    enumerable: false,
    value: async function preExistingCustomFetch() {
      throw new Error("unexpected external fetch");
    },
  });
}
const entry = captureDescriptors();
const instrumentation = installInstrumentation(target);
let callbackError = null;
let injected = false;
let fixtureReached = false;

try {
  await test(`${config.name}: actual Node fixture lifetime`, { timeout: 20000 }, async (context) => {
    try {
      const fixture = await import(target);
      if (config.direct === "composition-environment") {
        const environment = fixture.installCompositionEnvironment();
        context.after(() => environment.restore());
        fixtureReached = true;
        interrupt("after-install");
      } else if (config.direct === "composition-host") {
        await assert.rejects(
          fixture.createChatWindowBundle(fixture.createCompositionHost(), { failAcquisition: true }),
        );
        fixtureReached = true;
      } else if (config.direct === "file-environment") {
        context.after(() => fixture.restoreGlobals());
        fixtureReached = true;
        interrupt("after-install");
      } else {
        await runRegisteredCallback(config, context);
        fixtureReached = true;
      }
    } catch (error) {
      injected = isInjected(error);
      if (injected) fixtureReached = true;
      else callbackError = { name: error.name, message: error.message, stack: error.stack };
    } finally {
      registerFinalHooks(context);
    }
  });

  await test(`${config.name}: entry descriptors after all hooks`, { timeout: 20000 }, async () => {
    const differences = descriptorDifferences(entry);
    let followingDifferences = [];
    let followingError = null;
    try {
      followingDifferences = await observeFollowingFixture(followingUrl);
    } catch (error) {
      followingError = { name: error.name, message: error.message };
    }
    const afterFollowing = descriptorDifferences(entry);
    const faultExpected =
      Boolean(config.boundary) || ["composition-environment", "file-environment"].includes(config.direct);
    const witness = faultWitness();
    const executionValid =
      fixtureReached && callbackError === null && (faultExpected ? injected && Boolean(witness) : !injected);
    // The independent snapshots above precede emergency cleanup, including the next fixture.
    const result = {
      ...config,
      executionValid,
      faultExpected,
      injected,
      witness,
      callbackError,
      differences,
      followingDifferences,
      followingError,
      afterFollowing,
    };
    console.log("FIXTURE_RESULT", JSON.stringify(result));
    emergencyRestore(entry);
    assert.equal(executionValid, true, `FIXTURE_EXECUTION_INVALID:${JSON.stringify({ callbackError, witness })}`);
    assert.equal(differences.length, 0, `RESTORATION_CONTRACT:${differences.map((item) => item.name).join(",")}`);
    assert.equal(followingError, null, "RESTORATION_CONTRACT:following-fixture-acquisition");
    assert.equal(followingDifferences.length, 0, "RESTORATION_CONTRACT:following-fixture-descriptors");
    assert.equal(afterFollowing.length, 0, `RESTORATION_CONTRACT:${afterFollowing.map((item) => item.name).join(",")}`);
  });
} finally {
  instrumentation.deregister();
  originalClearTimeout(watchdog);
}

// target: scripts/phase-8-fixture-descriptors.mjs
// Contract: spec §3.4 / plan §2.7 / ASTRA-R10-F001; independent full entry-descriptor oracle.
// Expected failure features: RESTORATION_CONTRACT:fetch / RESTORATION_CONTRACT:navigator.
import assert from "node:assert/strict";

const globalNames = [
  "window",
  "document",
  "HTMLElement",
  "Event",
  "Node",
  "navigator",
  "fetch",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "ResizeObserver",
  "IntersectionObserver",
  "localStorage",
  "IS_REACT_ACT_ENVIRONMENT",
  "__compositionHost",
  "createImageBitmap",
  "KeyboardEvent",
  "WheelEvent",
  "TouchEvent",
  "Element",
  "Date",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
];
const hostNames = () => Object.getOwnPropertyNames(globalThis).filter((name) => name.startsWith("__sessionHookHost_"));

export function captureDescriptors() {
  const entries = [...new Set([...globalNames, ...hostNames()])].map((name) => ({
    owner: globalThis,
    name,
    descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
  }));
  entries.push(
    { owner: URL, name: "createObjectURL", descriptor: Object.getOwnPropertyDescriptor(URL, "createObjectURL") },
    { owner: console, name: "error", descriptor: Object.getOwnPropertyDescriptor(console, "error") },
  );
  return entries;
}

function describe(descriptor) {
  if (!descriptor) return null;
  return Object.fromEntries(
    Object.entries(descriptor).map(([key, value]) => [
      key,
      typeof value === "function"
        ? `[Function:${value.name}]`
        : value === undefined
          ? "[undefined]"
          : value && typeof value === "object"
            ? "[Object]"
            : value,
    ]),
  );
}

export function descriptorDifferences(entries) {
  const differences = [];
  for (const { owner, name, descriptor } of entries) {
    const actual = Object.getOwnPropertyDescriptor(owner, name);
    try {
      assert.deepEqual(actual, descriptor);
      // Preserve identity as well as every descriptor field, including object-valued globals.
      for (const key of ["value", "get", "set"]) assert.strictEqual(actual?.[key], descriptor?.[key]);
    } catch {
      differences.push({ name, expected: describe(descriptor), actual: describe(actual) });
    }
  }
  const known = new Set(entries.filter((entry) => entry.owner === globalThis).map((entry) => entry.name));
  for (const name of hostNames()) {
    if (!known.has(name)) differences.push({ name, expected: null, actual: "leaked host binding" });
  }
  return differences;
}

export function emergencyRestore(entries) {
  const known = new Set(entries.filter((entry) => entry.owner === globalThis).map((entry) => entry.name));
  for (const name of hostNames()) if (!known.has(name)) delete globalThis[name];
  for (const { owner, name, descriptor } of entries) {
    if (descriptor) Object.defineProperty(owner, name, descriptor);
    else delete owner[name];
  }
}

export async function observeFollowingFixture(moduleUrl) {
  const fixture = await import(moduleUrl);
  const before = captureDescriptors();
  const environment = fixture.installCompositionEnvironment();
  let release;
  try {
    const acquired = await fixture.createChatWindowBundle(fixture.createCompositionHost());
    release = acquired.releaseHost;
    assert.equal(typeof acquired.ChatWindow, "function", "FOLLOWING_FIXTURE_ACQUIRED");
  } finally {
    try {
      await release?.();
    } finally {
      environment.restore();
    }
  }
  return descriptorDifferences(before);
}

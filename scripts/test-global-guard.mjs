import { beforeEach } from "node:test";

const PRELOADED_BY_DEPENDENCIES = new Set(["regeneratorRuntime"]);
const DESCRIPTOR_FIELDS = ["value", "get", "set", "writable", "enumerable", "configurable"];

function snapshotGlobals() {
  const globals = new Map();
  for (const name of Reflect.ownKeys(globalThis)) {
    if (typeof name !== "string" || PRELOADED_BY_DEPENDENCIES.has(name)) continue;
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  return globals;
}

function sameDescriptor(left, right) {
  return DESCRIPTOR_FIELDS.every((field) => Object.is(left?.[field], right?.[field]));
}

function changedGlobals(before, after) {
  const names = [];
  for (const [name, descriptor] of after) {
    if (!before.has(name) || !sameDescriptor(before.get(name), descriptor)) names.push(name);
  }
  for (const name of before.keys()) if (!after.has(name)) names.push(name);
  return names;
}

if (process.env.NODE_TEST_CONTEXT) {
  const initial = snapshotGlobals();
  const leaks = [];
  let previous = null;
  beforeEach((context) => {
    if (context.fullName !== context.name) return;
    const globals = snapshotGlobals();
    if (previous) {
      const names = changedGlobals(previous.globals, globals);
      if (names.length) leaks.push({ test: previous.name, names });
    }
    previous = { name: context.name, globals };
  });
  process.once("beforeExit", () => {
    const testNames = new Set(leaks.flatMap(({ names }) => names));
    const fileNames = changedGlobals(initial, snapshotGlobals()).filter((name) => !testNames.has(name));
    if (!leaks.length && !fileNames.length) return;
    for (const { test, names } of leaks) console.error(`GLOBAL_LEAK test "${test}" left: ${names.join(", ")}`);
    if (fileNames.length) console.error(`GLOBAL_LEAK file setup or teardown left: ${fileNames.join(", ")}`);
    process.exitCode = 1;
  });
}

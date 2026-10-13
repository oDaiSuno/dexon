// target: scripts/phase-8-fixture-instrumentation.mjs
// Contract: spec §3.4 / plan §2.7 / ASTRA-R10-F001; observe assertions, never replace cleanup.
// Injected exceptions are instrumentation, not qualifying RESTORATION_CONTRACT failures.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

export const registry = { tests: [], before: [], beforeEach: [], afterEach: [], after: [] };
export const captureTest = (name, options, callback) => registry.tests.push({ name, callback: callback ?? options });
export const captureBefore = (callback) => registry.before.push(callback);
export const captureBeforeEach = (callback) => registry.beforeEach.push(callback);
export const captureAfterEach = (callback) => registry.afterEach.push(callback);
export const captureAfter = (callback) => registry.after.push(callback);
const normalize = (value) => String(value).replace(/\s+/g, " ").trim();
const injectedErrors = new WeakSet();
let active = false;
let boundary = null;
let witness = null;

export function interrupt(label) {
  witness = label;
  const error = new Error(`REVIEW_INJECTED_ASSERTION:${label}`);
  injectedErrors.add(error);
  throw error;
}

export function isInjected(error) {
  return injectedErrors.has(error);
}

function afterAssertion(method, args) {
  if (!active || !boundary || witness) return;
  const matches =
    boundary.kind === "first" ||
    (boundary.kind === "method" && boundary.method === method) ||
    (boundary.kind === "message" &&
      typeof args.at(-1) === "string" &&
      normalize(args.at(-1)) === normalize(boundary.text));
  if (matches) interrupt(`${boundary.kind}:${boundary.text ?? boundary.method ?? method}`);
}

function observeAssertion(method, callable, args) {
  // First let the real assertion finish. In particular, consume rejects()'s
  // promise before interrupting, so injection cannot create an unhandled rejection.
  const result = Reflect.apply(callable, assert, args);
  if (result && typeof result.then === "function") {
    return result.then((value) => {
      afterAssertion(method, args);
      return value;
    });
  }
  afterAssertion(method, args);
  return result;
}

const assertionMethods = new Set([
  "ok",
  "equal",
  "notEqual",
  "strictEqual",
  "notStrictEqual",
  "deepEqual",
  "notDeepEqual",
  "deepStrictEqual",
  "notDeepStrictEqual",
  "match",
  "doesNotMatch",
  "throws",
  "doesNotThrow",
  "rejects",
  "doesNotReject",
  "ifError",
  "fail",
]);
export const observedAssert = new Proxy(assert, {
  apply(target, receiver, args) {
    return observeAssertion("ok", target, args);
  },
  get(target, name, receiver) {
    if (name === "strict") return receiver;
    const value = Reflect.get(target, name, receiver);
    if (!assertionMethods.has(name)) return value;
    return (...args) => observeAssertion(name, value, args);
  },
});

export function installInstrumentation(target) {
  const helper = JSON.stringify(import.meta.url);
  const registration = `export { captureTest as default, captureTest as test,
    captureBefore as before, captureBeforeEach as beforeEach,
    captureAfterEach as afterEach, captureAfter as after } from ${helper};`;
  const assertions = `export { observedAssert as default } from ${helper};`;
  const dataUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
  return registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL !== target) return next(specifier, context);
      if (specifier === "node:test") return { url: dataUrl(registration), shortCircuit: true };
      if (specifier === "node:assert/strict") return { url: dataUrl(assertions), shortCircuit: true };
      return next(specifier, context);
    },
  });
}

export async function runRegisteredCallback(config, context) {
  const matches = registry.tests.filter((entry) => normalize(entry.name) === normalize(config.title));
  assert.equal(matches.length, 1, `INSTRUMENTATION_REGISTRATION:${config.title}`);
  const selected = matches[0];
  assert.equal(typeof selected.callback, "function", "INSTRUMENTATION_CALLBACK_MISSING");
  for (const callback of registry.before) await callback(context);
  for (const callback of registry.beforeEach) await callback(context);
  boundary = config.boundary;
  active = true;
  try {
    await selected.callback(context);
  } finally {
    active = false;
  }
}

export function registerFinalHooks(context) {
  for (const callback of registry.afterEach) context.after(() => callback(context));
  for (const callback of registry.after) context.after(() => callback(context));
}

export function faultWitness() {
  return witness;
}

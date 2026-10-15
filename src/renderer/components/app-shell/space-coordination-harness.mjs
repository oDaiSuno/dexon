import { createElement } from "react";
import { act } from "react";
import { create } from "react-test-renderer";
// Shared harness for the space-coordination behavior tests. Tests inject an
// I/O recorder; no real bridge, home directory, or Agent Host is touched.

export function createIo(overrides = {}) {
  const calls = {
    readStored: [],
    validated: [],
    prepared: 0,
    persisted: [],
    opened: [],
  };
  const io = {
    readStoredSpaceCwd: async () => {
      calls.readStored.push(Date.now());
      return calls.storedValue ?? null;
    },
    validateSpace: async (value) => {
      calls.validated.push(value);
      return value;
    },
    preparePersonalSpace: async () => {
      calls.prepared += 1;
      return "/Users/tester/.dexon";
    },
    persistSpaceCwd: async (value) => {
      calls.persisted.push(value);
    },
    openDirectory: async (value) => {
      calls.opened.push(value);
    },
    ...overrides,
  };
  return { io, calls };
}

/** Deterministically flush pending microtask continuations inside act(). */
export async function settle(rounds = 6) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export function baseProps(overrides = {}) {
  return {
    sessionIntent: null,
    sessionResolved: true,
    sessionFound: false,
    sessionCwd: null,
    ...overrides,
  };
}

export async function mountCoordination(t, useSpaceCoordination, record, props = {}) {
  const { io } = record;
  const original = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let snapshot = null;
  const Probe = (probeProps) => {
    snapshot = useSpaceCoordination({ ...probeProps, io });
    return null;
  };
  let renderer = null;
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    try {
      await act(async () => renderer?.unmount());
    } finally {
      if (original) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", original);
      else delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
  };
  t.after(unmount);
  await act(async () => {
    renderer = create(createElement(Probe, baseProps(props)));
  });
  return {
    get: () => snapshot,
    async rerender(next = {}) {
      await act(async () => {
        renderer.update(createElement(Probe, baseProps({ ...props, ...next })));
      });
    },
    unmount,
  };
}

import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the split-out skill directory owner: list
// loading with latest-request gating, cwd-change resets, selection
// fallback, toggle outcomes, and unmount cancellation.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { useSkillDirectory } = await importTestBundle("skills-directory", {
  stdin: {
    contents: 'export { useSkillDirectory } from "./src/renderer/components/skills/use-skill-directory.ts";',
    resolveDir: projectRoot,
    sourcefile: "skill-directory-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "skills-directory-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "skills-directory" }));
        build.onLoad({ filter: /.*/, namespace: "skills-directory" }, () => ({
          contents:
            "function stubT(_key, fallback) { return fallback; }\n" +
            'export function useI18n() { return { language: "en", t: stubT }; }',
          loader: "js",
        }));
      },
    },
  ],
});

function skill(name, overrides = {}) {
  return {
    name,
    description: `${name} description`,
    filePath: `/repo/.pi/agent/skills/${name}/SKILL.md`,
    baseDir: `/repo/.pi/agent/skills/${name}`,
    disableModelInvocation: false,
    sourceInfo: { source: "project", scope: "project" },
    ...overrides,
  };
}

const TIMED_GLOBALS = ["fetch", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment({ fetchImpl } = {}) {
  const originals = new Map(TIMED_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  globalThis.fetch = fetchImpl ?? (() => Promise.reject(new Error("unexpected fetch in use-skill-directory test")));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    async restore() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

function createDeferredFetch() {
  const pending = [];
  const fetchImpl = (url, options) => {
    const deferred = createDeferred();
    pending.push({ url, options, deferred });
    return deferred.promise;
  };
  return { fetchImpl, pending };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function skillsResponse(skillsList, ok = true) {
  return { ok, json: async () => ({ skills: skillsList }) };
}

function createProbe() {
  const state = { value: undefined };
  function Probe({ cwd }) {
    state.value = useSkillDirectory(cwd);
    return null;
  }
  return { state, Probe };
}

async function mountProbe(Probe, cwd) {
  let renderer;
  await act(async () => {
    renderer = create(createElement(Probe, { cwd }));
  });
  return {
    update: async (nextCwd) => {
      await act(async () => {
        renderer.update(createElement(Probe, { cwd: nextCwd }));
      });
    },
    unmount: async () => {
      await act(async () => {
        renderer.unmount();
      });
    },
  };
}

async function withEnvironment(options, run) {
  const env = installEnvironment(options);
  try {
    await run(env);
  } finally {
    await env.restore();
  }
}

test("loads the skill list on mount and selects the first entry", async () => {
  const { fetchImpl, pending } = createDeferredFetch();
  await withEnvironment({ fetchImpl }, async () => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, "/repo");
    assert.equal(state.value.loading, true);
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha"), skill("beta")]));
      await pending[0].deferred.promise;
    });
    assert.equal(state.value.loading, false);
    assert.equal(state.value.error, null);
    assert.deepEqual(
      state.value.skills.map((item) => item.name),
      ["alpha", "beta"],
    );
    assert.equal(state.value.selected, "/repo/.pi/agent/skills/alpha/SKILL.md");
    assert.equal(pending[0].url, "/api/skills?cwd=%2Frepo");
    await mounted.unmount();
  });
});

test("a failed load keeps the list empty and surfaces the error", async () => {
  const { fetchImpl, pending } = createDeferredFetch();
  await withEnvironment({ fetchImpl }, async () => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve({ ok: false, status: 500, json: async () => ({}) });
      await pending[0].deferred.promise;
    });
    assert.equal(state.value.loading, false);
    assert.deepEqual(state.value.skills, []);
    assert.equal(state.value.error, "HTTP 500");
    await mounted.unmount();
  });
});

test("changing cwd clears the prior list and the replacement response wins", async () => {
  const { fetchImpl, pending } = createDeferredFetch();
  await withEnvironment({ fetchImpl }, async () => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise;
    });
    assert.equal(state.value.selected, "/repo/.pi/agent/skills/alpha/SKILL.md");

    await mounted.update("/other");
    // The cwd change clears the old list before the replacement arrives.
    assert.deepEqual(state.value.skills, []);
    assert.equal(state.value.selected, null);
    assert.equal(pending.length, 2);
    assert.equal(pending[1].url, "/api/skills?cwd=%2Fother");

    await act(async () => {
      pending[1].deferred.resolve(
        skillsResponse([
          skill("gamma", {
            filePath: "/other/.pi/agent/skills/gamma/SKILL.md",
            baseDir: "/other/.pi/agent/skills/gamma",
          }),
        ]),
      );
      await pending[1].deferred.promise;
    });
    assert.deepEqual(
      state.value.skills.map((item) => item.name),
      ["gamma"],
    );
    assert.equal(state.value.selected, "/other/.pi/agent/skills/gamma/SKILL.md");
    await mounted.unmount();
  });
});

// A refresh superseded by a newer loadSkills() is settled late, after the
// replacement has already been applied; none of its settlements may win.
test("a superseded refresh success cannot overwrite the current list", async () => {
  const { fetchImpl, pending } = createDeferredFetch();
  await withEnvironment({ fetchImpl }, async () => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise;
    });

    // Two refreshes are issued before either settles; the first is superseded.
    await act(async () => {
      state.value.loadSkills();
    });
    await act(async () => {
      state.value.loadSkills();
    });
    assert.equal(state.value.loading, true);

    await act(async () => {
      pending[2].deferred.resolve(skillsResponse([skill("fresh")]));
      await pending[2].deferred.promise;
    });
    assert.deepEqual(
      state.value.skills.map((item) => item.name),
      ["fresh"],
    );
    assert.equal(state.value.loading, false);

    // The superseded request settles late with stale data.
    await act(async () => {
      pending[1].deferred.resolve(skillsResponse([skill("stale")]));
      await pending[1].deferred.promise;
    });
    assert.deepEqual(
      state.value.skills.map((item) => item.name),
      ["fresh"],
      "a late superseded success must not overwrite the applied list",
    );
    assert.equal(state.value.selected, "/repo/.pi/agent/skills/fresh/SKILL.md");
    await mounted.unmount();
  });
});

test("a superseded refresh rejection cannot set the error state", async () => {
  const { fetchImpl, pending } = createDeferredFetch();
  await withEnvironment({ fetchImpl }, async () => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise;
    });
    await act(async () => {
      state.value.loadSkills();
    });
    await act(async () => {
      state.value.loadSkills();
    });
    await act(async () => {
      pending[2].deferred.resolve(skillsResponse([skill("fresh")]));
      await pending[2].deferred.promise;
    });

    await act(async () => {
      pending[1].deferred.reject(new Error("stale network failure"));
      await pending[1].deferred.promise.catch(() => {});
    });
    assert.equal(state.value.error, null, "a late superseded rejection must not surface");
    assert.deepEqual(
      state.value.skills.map((item) => item.name),
      ["fresh"],
    );
    assert.equal(state.value.loading, false);
    await mounted.unmount();
  });
});

test("a superseded refresh finalization cannot clear the current loading state", async () => {
  const { fetchImpl, pending } = createDeferredFetch();
  await withEnvironment({ fetchImpl }, async () => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise;
    });
    await act(async () => {
      state.value.loadSkills();
    });
    await act(async () => {
      state.value.loadSkills();
    });
    assert.equal(state.value.loading, true);

    // The superseded request settles (with a rejection) while the current
    // request is still pending: loading must stay true and no error appears.
    await act(async () => {
      pending[1].deferred.reject(new Error("stale network failure"));
      await pending[1].deferred.promise.catch(() => {});
    });
    assert.equal(state.value.loading, true, "the stale finally must not clear the active request's loading");
    assert.equal(state.value.error, null);

    await act(async () => {
      pending[2].deferred.resolve(skillsResponse([skill("fresh")]));
      await pending[2].deferred.promise;
    });
    assert.equal(state.value.loading, false);
    assert.deepEqual(
      state.value.skills.map((item) => item.name),
      ["fresh"],
    );
    await mounted.unmount();
  });
});

test("selection is kept when still present and falls back to the first entry otherwise", async () => {
  const { fetchImpl, pending } = createDeferredFetch();
  await withEnvironment({ fetchImpl }, async () => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha"), skill("beta")]));
      await pending[0].deferred.promise;
    });
    await act(async () => {
      state.value.setSelected("/repo/.pi/agent/skills/beta/SKILL.md");
    });
    // A refresh that keeps the selection must not move it.
    await act(async () => {
      state.value.loadSkills();
    });
    await act(async () => {
      pending[1].deferred.resolve(skillsResponse([skill("beta"), skill("alpha")]));
      await pending[1].deferred.promise;
    });
    assert.equal(state.value.selected, "/repo/.pi/agent/skills/beta/SKILL.md");
    // A refresh without the selection falls back to the first entry.
    await act(async () => {
      state.value.loadSkills();
    });
    await act(async () => {
      pending[2].deferred.resolve(skillsResponse([skill("gamma")]));
      await pending[2].deferred.promise;
    });
    assert.equal(state.value.selected, "/repo/.pi/agent/skills/gamma/SKILL.md");
    await mounted.unmount();
  });
});

test("toggle success updates the visibility flag and releases the busy mark", async () => {
  const { fetchImpl, pending } = createDeferredFetch();
  await withEnvironment({ fetchImpl }, async () => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise;
    });
    const target = state.value.skills[0];
    let settled;
    await act(async () => {
      settled = state.value.toggle(target);
    });
    assert.equal(state.value.toggling.has(target.filePath), true);
    await act(async () => {
      pending[1].deferred.resolve({ ok: true, json: async () => ({ success: true }) });
      await settled;
    });
    assert.equal(state.value.skills[0].disableModelInvocation, true);
    assert.equal(state.value.toggling.has(target.filePath), false);
    assert.equal(state.value.saveError, null);
    assert.equal(pending[1].url, "/api/skills");
    await mounted.unmount();
  });
});

test("toggle failure reports the error and never mutates the list", async () => {
  const { fetchImpl, pending } = createDeferredFetch();
  await withEnvironment({ fetchImpl }, async () => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise;
    });
    const target = state.value.skills[0];
    let settled;
    await act(async () => {
      settled = state.value.toggle(target);
    });
    await act(async () => {
      pending[1].deferred.resolve({ ok: false, json: async () => ({ error: "disk full" }) });
      await settled;
    });
    assert.equal(state.value.saveError, "disk full");
    assert.equal(state.value.skills[0].disableModelInvocation, false);
    assert.equal(state.value.toggling.has(target.filePath), false);
    await mounted.unmount();
  });
});

test("unmounting cancels an in-flight list request", async () => {
  const { fetchImpl, pending } = createDeferredFetch();
  await withEnvironment({ fetchImpl }, async () => {
    const { Probe } = createProbe();
    const mounted = await mountProbe(Probe, "/repo");
    assert.equal(pending.length, 1);
    await mounted.unmount();
    assert.equal(pending[0].options.signal.aborted, true);
  });
});

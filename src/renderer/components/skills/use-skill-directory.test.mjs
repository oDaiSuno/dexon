import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
import { createDeferredHost, hostError } from "../../../../tests/support/deferred-host.mjs";
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

const { useSkillDirectory, resetRpc, installApiShims } = await importTestBundle("skills-directory", {
  stdin: {
    contents:
      'export { useSkillDirectory } from "./src/renderer/components/skills/use-skill-directory.ts"; export {resetRpc} from "./src/renderer/lib/api-client.ts"; export {installApiShims} from "./src/renderer/lib/api-fetch.ts";',
    resolveDir: projectRoot,
    sourcefile: "skill-directory-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
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

const TIMED_GLOBALS = ["window", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment({ host } = {}) {
  const originals = new Map(TIMED_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const cleanups = [];
  globalThis.window = { location: { href: "http://localhost/" }, localStorage: { getItem: () => null } };
  const boundary = installRendererApi(globalThis.window, { installApiShims, resetRpc }, () => host);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    ownCleanup(cleanup) {
      cleanups.push(cleanup);
    },
    async restore() {
      const errors = [];
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        boundary.close();
      } catch (error) {
        errors.push(error);
      }
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      if (errors.length) throw new AggregateError(errors, "Skill directory cleanup failed");
    },
  };
}

function createDeferredRequests() {
  const host = createDeferredHost(["skills.list", "skills.set"]);
  return { host, pending: host.pending };
}

function skillsResponse(skillsList) {
  return { skills: skillsList };
}

function createProbe() {
  const state = { value: undefined };
  function Probe({ cwd }) {
    state.value = useSkillDirectory(cwd);
    return null;
  }
  return { state, Probe };
}

async function mountProbe(env, Probe, cwd) {
  let renderer;
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => renderer?.unmount());
  };
  env.ownCleanup(unmount);
  await act(async () => {
    renderer = create(createElement(Probe, { cwd }));
  });
  return {
    update: async (nextCwd) => {
      await act(async () => {
        renderer.update(createElement(Probe, { cwd: nextCwd }));
      });
    },
    unmount,
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
  const { host, pending } = createDeferredRequests();
  await withEnvironment({ host }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, "/repo");
    assert.equal(state.value.loading, true);
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha"), skill("beta")]));
      await pending[0].deferred.promise.catch(() => {});
    });
    assert.equal(state.value.loading, false);
    assert.equal(state.value.error, null);
    assert.deepEqual(
      state.value.skills.map((item) => item.name),
      ["alpha", "beta"],
    );
    assert.equal(state.value.selected, "/repo/.pi/agent/skills/alpha/SKILL.md");
    assert.equal(pending[0].method, "skills.list");
    assert.deepEqual(pending[0].params, { cwd: "/repo" });
    await mounted.unmount();
  });
});

test("a failed load keeps the list empty and surfaces the error", async () => {
  const { host, pending } = createDeferredRequests();
  await withEnvironment({ host }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, "/repo");
    await act(async () => {
      pending[0].deferred.reject(hostError("Skill directory unavailable"));
      await pending[0].deferred.promise.catch(() => {});
    });
    assert.equal(state.value.loading, false);
    assert.deepEqual(state.value.skills, []);
    assert.equal(state.value.error, "Skill directory unavailable");
    await mounted.unmount();
  });
});

test("changing cwd clears the prior list and the replacement response wins", async () => {
  const { host, pending } = createDeferredRequests();
  await withEnvironment({ host }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise.catch(() => {});
    });
    assert.equal(state.value.selected, "/repo/.pi/agent/skills/alpha/SKILL.md");

    await mounted.update("/other");
    // The cwd change clears the old list before the replacement arrives.
    assert.deepEqual(state.value.skills, []);
    assert.equal(state.value.selected, null);
    assert.equal(pending.length, 2);
    assert.equal(pending[1].method, "skills.list");
    assert.deepEqual(pending[1].params, { cwd: "/other" });

    await act(async () => {
      pending[1].deferred.resolve(
        skillsResponse([
          skill("gamma", {
            filePath: "/other/.pi/agent/skills/gamma/SKILL.md",
            baseDir: "/other/.pi/agent/skills/gamma",
          }),
        ]),
      );
      await pending[1].deferred.promise.catch(() => {});
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
  const { host, pending } = createDeferredRequests();
  await withEnvironment({ host }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise.catch(() => {});
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
      await pending[2].deferred.promise.catch(() => {});
    });
    assert.deepEqual(
      state.value.skills.map((item) => item.name),
      ["fresh"],
    );
    assert.equal(state.value.loading, false);

    // The superseded request settles late with stale data.
    await act(async () => {
      pending[1].deferred.resolve(skillsResponse([skill("stale")]));
      await pending[1].deferred.promise.catch(() => {});
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
  const { host, pending } = createDeferredRequests();
  await withEnvironment({ host }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise.catch(() => {});
    });
    await act(async () => {
      state.value.loadSkills();
    });
    await act(async () => {
      state.value.loadSkills();
    });
    await act(async () => {
      pending[2].deferred.resolve(skillsResponse([skill("fresh")]));
      await pending[2].deferred.promise.catch(() => {});
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
  const { host, pending } = createDeferredRequests();
  await withEnvironment({ host }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise.catch(() => {});
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
      await pending[2].deferred.promise.catch(() => {});
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
  const { host, pending } = createDeferredRequests();
  await withEnvironment({ host }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha"), skill("beta")]));
      await pending[0].deferred.promise.catch(() => {});
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
      await pending[1].deferred.promise.catch(() => {});
    });
    assert.equal(state.value.selected, "/repo/.pi/agent/skills/beta/SKILL.md");
    // A refresh without the selection falls back to the first entry.
    await act(async () => {
      state.value.loadSkills();
    });
    await act(async () => {
      pending[2].deferred.resolve(skillsResponse([skill("gamma")]));
      await pending[2].deferred.promise.catch(() => {});
    });
    assert.equal(state.value.selected, "/repo/.pi/agent/skills/gamma/SKILL.md");
    await mounted.unmount();
  });
});

test("toggle success updates the visibility flag and releases the busy mark", async () => {
  const { host, pending } = createDeferredRequests();
  await withEnvironment({ host }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise.catch(() => {});
    });
    const target = state.value.skills[0];
    let settled;
    await act(async () => {
      settled = state.value.toggle(target);
    });
    assert.equal(state.value.toggling.has(target.filePath), true);
    await act(async () => {
      pending[1].deferred.resolve({ ok: true });
      await settled;
    });
    assert.equal(state.value.skills[0].disableModelInvocation, true);
    assert.equal(state.value.toggling.has(target.filePath), false);
    assert.equal(state.value.saveError, null);
    assert.equal(pending[1].method, "skills.set");
    assert.deepEqual(pending[1].params, { cwd: "/repo", filePath: target.filePath, disableModelInvocation: true });
    await mounted.unmount();
  });
});

test("toggle failure reports the error and never mutates the list", async () => {
  const { host, pending } = createDeferredRequests();
  await withEnvironment({ host }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, "/repo");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("alpha")]));
      await pending[0].deferred.promise.catch(() => {});
    });
    const target = state.value.skills[0];
    let settled;
    await act(async () => {
      settled = state.value.toggle(target);
    });
    await act(async () => {
      pending[1].deferred.reject(hostError("disk full"));
      await settled;
    });
    assert.equal(state.value.saveError, "disk full");
    assert.equal(state.value.skills[0].disableModelInvocation, false);
    assert.equal(state.value.toggling.has(target.filePath), false);
    await mounted.unmount();
  });
});

test("a pending load from the previous cwd cannot replace the current skill selection", async () => {
  const { host, pending } = createDeferredRequests();
  await withEnvironment({ host }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, "/repo");
    assert.equal(pending.length, 1);
    await mounted.update("/other");
    await act(async () => {
      pending[1].deferred.resolve(skillsResponse([skill("current", { filePath: "/other/skills/current/SKILL.md" })]));
      await pending[1].deferred.promise;
    });
    assert.equal(state.value.selected, "/other/skills/current/SKILL.md");
    await act(async () => {
      pending[0].deferred.resolve(skillsResponse([skill("late")]));
      await pending[0].deferred.promise;
    });
    assert.equal(
      state.value.selected,
      "/other/skills/current/SKILL.md",
      "the previous directory's late reply cannot replace the current list",
    );
  });
});

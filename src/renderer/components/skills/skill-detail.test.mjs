import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRef } from "react";
import { createDeferred } from "#test-timing";
import { act, button, dom, input, loadRenderer, mount, restoreGlobals } from "../../../../tests/support/renderer.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
import { hostError } from "../../../../tests/support/deferred-host.mjs";

after(restoreGlobals);
const api = await loadRenderer(
  "skills-detail",
  'export { SkillDetail } from "./src/renderer/components/skills/skill-detail.tsx";',
);

const SAMPLE_SKILL = {
  name: "alpha",
  description: "alpha description",
  filePath: "/repo/.pi/agent/skills/alpha/SKILL.md",
  baseDir: "/repo/.pi/agent/skills/alpha",
  disableModelInvocation: false,
  sourceInfo: { source: "project", scope: "project" },
};

async function detail(t) {
  const calls = { getContent: [], patchBodies: [], toggles: [], saved: 0, dirty: [] };
  const pending = [];
  const contents = [];
  const host = installRendererApi(dom.window, api, () => ({
    call(method, params) {
      const deferred = createDeferred();
      if (method === "skills.set") {
        pending.push(deferred);
        calls.patchBodies.push(params);
      } else {
        assert.equal(method, "skills.getContent");
        calls.getContent.push({ method, params });
        contents.push(deferred);
      }
      return deferred.promise;
    },
  }));
  const ref = createRef();
  const view = await mount(
    t,
    api.SkillDetail,
    {
      ref,
      skill: SAMPLE_SKILL,
      cwd: "/repo",
      onToggle: (target) => calls.toggles.push(target),
      toggling: false,
      saveError: null,
      onSaved: () => calls.saved++,
      onDirtyChange: (dirty) => calls.dirty.push(dirty),
    },
    { release: host.close },
  );
  return {
    ...view,
    ref,
    calls,
    pending,
    textarea: () => view.container.querySelector("textarea"),
    async load(content) {
      await act(async () => {
        contents[0].resolve({ content });
        await contents[0].promise;
      });
    },
  };
}

test("loads the skill file through the real client and disables saving while clean", async (t) => {
  const view = await detail(t);
  assert.equal(view.ref.current.hasUnsavedChanges(), false);
  await view.load("# Alpha\n\nBody");
  assert.deepEqual(view.calls.getContent, [
    { method: "skills.getContent", params: { cwd: "/repo", filePath: SAMPLE_SKILL.filePath } },
  ]);
  assert.equal(view.textarea().value, "# Alpha\n\nBody");
  assert.equal(button(view.container, "Save changes").disabled, true);
});

test("editing marks the editor dirty through its declared handle and callback", async (t) => {
  const view = await detail(t);
  await view.load("# Alpha");
  await input(view.textarea(), "# Alpha edited");
  assert.equal(view.ref.current.hasUnsavedChanges(), true);
  assert.equal(view.calls.dirty.at(-1), true);
  assert.equal(button(view.container, "Save changes").disabled, false);
  await view.unmount();
  assert.equal(view.calls.dirty.at(-1), false, "unmount clears the dirty notification");
});

test("saving writes the edited content to the original cwd and file, then reports success", async (t) => {
  const view = await detail(t);
  await view.load("# Alpha");
  await input(view.textarea(), "# Alpha v2");
  let saved;
  await act(async () => {
    saved = view.ref.current.save();
  });
  assert.equal(view.pending.length, 1);
  await act(async () => {
    view.pending[0].resolve({ ok: true });
    saved = await saved;
  });
  assert.equal(saved, true);
  assert.deepEqual(view.calls.patchBodies[0], {
    cwd: "/repo",
    filePath: SAMPLE_SKILL.filePath,
    content: "# Alpha v2",
  });
  assert.equal(view.calls.saved, 1);
  assert.equal(view.ref.current.hasUnsavedChanges(), false);
  assert.equal(view.textarea().value, "# Alpha v2");
});

test("a failed save keeps the edited content and dirty flag and reports failure", async (t) => {
  const view = await detail(t);
  await view.load("# Alpha");
  await input(view.textarea(), "# Alpha v2");
  let saved;
  await act(async () => {
    saved = view.ref.current.save();
  });
  await act(async () => {
    view.pending[0].reject(hostError("Disk full"));
    saved = await saved;
  });
  assert.equal(saved, false);
  assert.equal(view.calls.saved, 0);
  assert.equal(view.ref.current.hasUnsavedChanges(), true);
  assert.equal(view.textarea().value, "# Alpha v2");
  assert.match(view.container.textContent, /Disk full/);
});

test("saving an unchanged editor returns true without issuing a request", async (t) => {
  const view = await detail(t);
  await view.load("# Alpha");
  let saved;
  await act(async () => {
    saved = await view.ref.current.save();
  });
  assert.equal(saved, true);
  assert.deepEqual(view.pending, []);
});

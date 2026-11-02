import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  control,
  keyDown,
  restoreGlobals,
  roles,
  startNavigation,
  waitFor,
} from "../support/app-navigation.mjs";
import {
  enabledAction,
  projectItem,
  projectMenu,
  projectOrder,
  unavailableAction,
} from "../support/app-navigation-projects.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

for (const status of ["running", "awaiting_input", "error"]) {
  test(`the full App ${status === "error" ? "allows" : "prevents"} closing a project whose conversation is ${status}`, async (t) => {
    const scene = await startNavigation(t, { openProjects: [P.personal, P.project] });
    await waitFor(() => projectItem(scene, "navigation-project"));
    await waitFor(() => assert.ok(scene.external.runningSubscribers() > 0));
    await act(async () => scene.external.running([], { "project-history": status }));
    const menu = await projectMenu(scene, "navigation-project");
    if (status === "error") {
      await click(enabledAction(menu, "Close project"));
      await waitFor(() => assert.deepEqual(projectOrder(scene), ["Default space"]));
    } else {
      unavailableAction(menu, "Close project");
      await keyDown(menu, "Escape");
      assert.deepEqual(projectOrder(scene), ["Default space", "navigation-project"]);
    }
  });
}

test("the full App rail follows live urgency while excluding activity outside the listed projects", async (t) => {
  const scene = await startNavigation(t, { openProjects: [P.personal, P.project] });
  await waitFor(() => projectItem(scene, "navigation-project"));
  await waitFor(() => assert.ok(scene.external.runningSubscribers() > 0));
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  const navigation = scene.navigation();
  const toggle = control(navigation, "button", "Show sidebar");
  assert.equal(navigation.style.width, "52px");
  assert.equal(roles(navigation, "button").length, 4);
  for (const [statuses, expectedColor, expectedPhrase] of [
    [{ "project-history": "running", "terminal-only-history": "awaiting_input" }, "var(--fx-accent-blue)", "1 running"],
    [{ "project-history": "running", "personal-history": "error" }, "var(--fx-status-danger)", "1 failed · 1 running"],
    [
      { "project-history": "running", "personal-history": "awaiting_input" },
      "var(--fx-status-warning)",
      "1 waiting for your answer · 1 running",
    ],
  ]) {
    await act(async () => scene.external.running([], statuses));
    await waitFor(() => assert.equal(toggle.getAttribute("aria-description"), expectedPhrase));
    const dot = toggle.querySelector("[data-activity]");
    assert.equal(dot.style.background, expectedColor);
    assert.equal(dot.style.top, "3px");
    assert.equal(dot.style.right, "3px");
    assert.equal(roles(navigation, "button").length, 4);
  }
  await act(async () => scene.external.running([], {}));
  await waitFor(() => assert.equal(toggle.querySelector("[data-activity]"), null));
  assert.equal(toggle.getAttribute("aria-description"), null);
});

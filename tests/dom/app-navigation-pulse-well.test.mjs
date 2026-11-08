import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  click,
  act,
  waitFor,
  roles,
  input,
  keyDown,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";

import { projectItem } from "../support/app-navigation-projects.mjs";

after(restoreGlobals);

test("background activity stays visible above collapsed projects", async (t) => {
  const scene = await startNavigation(t, { openProjects: [P.personal, P.project] });
  await waitFor(() => assert.ok(scene.external.runningSubscribers() > 0));
  await act(async () => scene.external.running([], { "project-history": "awaiting_input" }));
  const well = control(scene.navigation(), "region", "Active sessions");
  assert.match(well.textContent, /navigation-project/);
  await click(control(well, "button", /Project release notes/));
  await waitFor(() => assert.equal(scene.external.rememberedSpace(), P.project));
});

test("collapsed projects inherit waiting and completion unread while search preserves project expansion", async (t) => {
  const scene = await startNavigation(t, { openProjects: [P.personal, P.project] });
  await waitFor(() => assert.ok(scene.external.runningSubscribers() > 0));
  await act(async () => scene.external.running([], { "project-history": "awaiting_input" }));
  let project = projectItem(scene, "navigation-project");
  assert.match(project.textContent, /1 waiting for your answer/);
  assert.equal(control(project, "button", "navigation-project").getAttribute("aria-label"), "navigation-project");
  await act(async () => scene.external.running(["project-history"]));
  await act(async () => scene.external.running([]));
  project = projectItem(scene, "navigation-project");
  assert.match(project.textContent, /1 unread/);
  const well = control(scene.navigation(), "region", "Active sessions");
  const completed = control(well, "button", /Project release notes · 1 unread/);
  assert.match(completed.textContent, /New activity/);
  await click(completed);
  await waitFor(() => {
    const revealed = projectItem(scene, "navigation-project");
    assert.equal(control(revealed, "button", "navigation-project").getAttribute("aria-expanded"), "true");
    assert.doesNotMatch(revealed.textContent, /1 unread/);
    assert.equal(roles(scene.navigation(), "region", "Active sessions").length, 0);
    assert.equal(control(scene.history(), "button", "Project release notes").getAttribute("aria-current"), "page");
  });
  const search = control(scene.navigation(), "searchbox", "Search sessions");
  await input(search, "release");
  await click(control(projectItem(scene, "navigation-project"), "button", "navigation-project"));
  await keyDown(search, "Escape");
  assert.equal(
    control(projectItem(scene, "navigation-project"), "button", "navigation-project").getAttribute("aria-expanded"),
    "true",
  );
});

test("a completed background delegate leaves the Well without creating unread activity", async (t) => {
  const { navigationBoundary } = await import("../fixtures/app-navigation-host.mjs");
  const { startedConversation } = await import("../fixtures/app-navigation-data.mjs");
  const options = { openProjects: [P.personal, P.project] };
  const external = navigationBoundary(options);
  const detail = startedConversation("done-child", P.project, "Completed delegate");
  Object.assign(detail.info, { name: "Completed delegate", parentSessionId: "project-history", relation: "delegate" });
  external.addConversation(detail);
  const scene = await startNavigation(t, options, external);
  await waitFor(() => assert.ok(external.runningSubscribers() > 0));
  await act(async () => external.running(["done-child"]));
  await act(async () => external.running([]));
  await scene.settled();
  assert.equal(roles(scene.navigation(), "region", "Active sessions").length, 0);
  assert.doesNotMatch(projectItem(scene, "navigation-project").textContent, /1 unread/);
  await click(control(projectItem(scene, "navigation-project"), "button", "navigation-project"));
  const parent = control(scene.history(), "button", "Project release notes").closest('[role="listitem"]');
  assert.equal(parent.querySelector('[aria-label="New session activity"]'), null);
  await click(control(parent, "button", "Expand forks"));
  const child = control(scene.history(), "button", /^Completed delegate(?: ·|$)/);
  assert.equal(child.querySelector('[aria-label="New session activity"]'), null);
});

test("live search yields a 28px Well summary and Escape restores the expanded Well and stored collapsed project", async (t) => {
  const scene = await startNavigation(t, { openProjects: [P.personal, P.project] });
  await waitFor(() => assert.ok(scene.external.runningSubscribers() > 0));
  await act(async () => scene.external.running(["review-history"], { "project-history": "awaiting_input" }));
  const project = () => control(projectItem(scene, "navigation-project"), "button", "navigation-project");
  assert.equal(project().getAttribute("aria-expanded"), "false");
  await click(project());
  assert.equal(project().getAttribute("aria-expanded"), "true");
  await click(project());
  assert.equal(project().getAttribute("aria-expanded"), "false", "the user explicitly stores a collapsed preference");
  const counts = "1 waiting for your answer · 1 running";
  const well = () => control(scene.navigation(), "region", "Active sessions");
  assert.equal(control(well(), "button", "Collapse active sessions").getAttribute("aria-description"), counts);
  const search = control(scene.navigation(), "searchbox", "Search sessions");
  await input(search, "release");
  const summary = control(well(), "button", `Expand active sessions · ${counts}`);
  assert.equal(summary.style.height, "28px");
  assert.equal(summary.style.boxSizing, "border-box");
  assert.equal(summary.getAttribute("aria-disabled"), "true");
  assert.equal(roles(well(), "button", "Collapse active sessions").length, 0);
  assert.equal(
    project().getAttribute("aria-expanded"),
    "true",
    "search shows matches without changing the stored preference",
  );
  await click(summary);
  await click(project());
  assert.equal(project().getAttribute("aria-expanded"), "true");
  await keyDown(search, "Escape");
  assert.equal(search.value, "");
  assert.equal(control(well(), "button", "Collapse active sessions").getAttribute("aria-description"), counts);
  assert.equal(roles(well(), "button", /Expand active sessions/).length, 0);
  assert.equal(
    project().getAttribute("aria-expanded"),
    "false",
    "Escape restores the stored false, not a search-time click",
  );
});

test("the urgent descendant is revealed again after refolding both ancestors and collapsing its selected project", async (t) => {
  const { navigationBoundary } = await import("../fixtures/app-navigation-host.mjs");
  const { startedConversation } = await import("../fixtures/app-navigation-data.mjs");
  const options = { openProjects: [P.personal, P.project] };
  const external = navigationBoundary(options);
  for (const [id, parent] of [
    ["middle", "project-history"],
    ["urgent", "middle"],
  ]) {
    const detail = startedConversation(id, P.project, id);
    Object.assign(detail.info, { name: id, parentSessionId: parent, relation: "delegate" });
    external.addConversation(detail);
  }
  const scene = await startNavigation(t, options, external);
  await waitFor(() => assert.ok(external.runningSubscribers() > 0));
  await act(async () => external.running([], { urgent: "awaiting_input" }));
  await click(control(projectItem(scene, "navigation-project"), "button", "navigation-project"));
  let history = scene.history();
  assert.equal(
    roles(history, "button", /urgent · Waiting for your answer/).length,
    0,
    "the project starts with child trees collapsed",
  );
  const well = control(scene.navigation(), "region", "Active sessions");
  await click(control(well, "button", /Project release notes/));
  await waitFor(() =>
    assert.equal(
      control(scene.history(), "button", /urgent · Waiting for your answer/).getAttribute("aria-current"),
      "page",
    ),
  );
  assert.ok(scene.history().querySelector('[data-session-id="urgent"]'));
  await click(roles(scene.history(), "button", "Collapse forks")[1]);
  await click(roles(scene.history(), "button", "Collapse forks")[0]);
  await scene.settled();
  assert.equal(
    roles(scene.history(), "button", /urgent · Waiting for your answer/).length,
    0,
    "manual collapse stays effective while the target remains selected",
  );
  await click(control(projectItem(scene, "navigation-project"), "button", "navigation-project"));
  await click(control(well, "button", /Project release notes/));
  await waitFor(() =>
    assert.equal(
      control(scene.history(), "button", /urgent · Waiting for your answer/).getAttribute("aria-current"),
      "page",
    ),
  );
  history = scene.history();
  assert.equal(roles(history, "button", "Expand forks").length, 0);
  assert.equal(
    control(projectItem(scene, "navigation-project"), "button", "navigation-project").getAttribute("aria-expanded"),
    "true",
  );
});

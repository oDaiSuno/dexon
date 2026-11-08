import assert from "node:assert/strict";
import path from "node:path";
import { clipboard } from "electron";
import { remoteProjectLabels as labels } from "../fixtures/remote-projects-native.mjs";
import { remoteProjectSelectors as selectors } from "./remote-projects-page.mjs";

export async function focusRemote({ driver, fixture, views }, name = "alpha") {
  await driver.closeSettings();
  await driver.openMenu(views[name], fixture.project);
  await driver.click({ role: "menuitem", name: labels.newSession });
  await driver.waitFor(
    async () => (await driver.read("text", { selector: selectors.attribution })).includes(views[name].label),
    "the native project action targets its own remote environment",
  );
  await driver.waitFor(async () => {
    const focus = (await driver.bridge("getUiState")).projectSpaces?.lastFocusedSpace;
    return focus?.environmentId === views[name].id && focus.path === fixture.project;
  }, "the real native project focus is persisted before another dialog opens");
}

export async function verifyUnifiedSidebar({ driver, fixture, views }) {
  await driver.waitFor(
    () => driver.exists({ role: "button", name: path.basename(fixture.project) }),
    "a unified zero-session remote project row",
  );
  const rows = await driver.read("rows");
  const local = rows.find((item) => !item.host && item.name === "Default space");
  assert.ok(local, "Local and remote projects use the same list");
  const nav = { role: "navigation", name: "Main navigation" };
  assert.equal(
    (await driver.page("elements", { role: "button", name: "Disconnect", scope: nav })).length,
    0,
    "Remote servers are no longer duplicated in the old standalone sidebar section",
  );
  const remote = await driver.row(views.alpha, fixture.project);
  assert.ok(remote, "The mounted zero-session project belongs to the shared Project spaces list");
  assert.equal(remote.tone, "online");
  assert.ok(remote.host.name.includes(labels.alpha), "The full server label is accessible despite truncation");
  assert.match(remote.host.name, /Online/u);
  assert.ok(remote.host.rect.width <= 74, "The remote host capsule respects the explicit 74px maximum width");
  assert.equal(remote.host.rect.height, 18);
  assert.ok(remote.chevron, "The remote project displays an expansion chevron");
  assert.ok(local.chevron, "The local project displays an expansion chevron");
  assert.equal(remote.chevron.rect.width, 14);
  assert.equal(remote.chevron.rect.height, 14);
  assert.equal(remote.glyph.rect.width, 14);
  assert.equal(remote.glyph.rect.height, 14);
  assert.equal(remote.chevron.rect.x, local.chevron.rect.x);
  assert.ok(remote.label, "The remote project name is measurable");
  assert.ok(local.label, "The local project name is measurable");
  assert.equal(remote.label.rect.x, local.label.rect.x);
  assert.equal(remote.label.rect.x - remote.rect.x, 57);
  assert.equal(local.label.rect.x - local.rect.x, 57);
  await driver.clickCss(driver.rowTarget(views.alpha, fixture.project));
  const toggled = await driver.row(views.alpha, fixture.project);
  assert.notEqual(toggled.expanded, remote.expanded, "The remote row expands and collapses like a local project");
  await driver.clickCss(driver.rowTarget(views.alpha, fixture.project));
  return {
    rows,
    expandedBefore: remote.expanded,
    expandedAfterNativeToggle: toggled.expanded,
    zeroSessionProject: true,
  };
}

export async function verifyRemoteMenu(context) {
  const { driver, fixture, views, mount } = context;
  await mount(views.beta, fixture.project);
  await driver.closeSettings();
  await driver.openMenu(views.alpha, fixture.project);
  const scope = { role: "menu", name: path.basename(fixture.project) };
  const menuText = await driver.page("text", { scope });
  assert.ok(menuText.includes(labels.alpha), "The menu exposes the full untruncated server label");
  assert.ok(menuText.includes(fixture.project), "The menu exposes the full canonical remote path");
  const menuItems = await driver.page("elements", { role: "menuitem", scope });
  const finder = menuItems.find((item) => item.name === labels.finder);
  assert.equal(menuItems.length, 7, "The Remote menu includes six regular actions and the disabled local Finder item");
  assert.ok(finder?.disabled, "A remote project cannot open the local Finder");
  const actionNames = menuItems.filter((item) => item !== finder).map((item) => item.name);
  assert.deepEqual(
    actionNames,
    [labels.newSession, labels.copy, labels.serverSettings, "Move up", "Move down", labels.remove],
    "The six regular Remote actions retain their approved relative order",
  );
  const finderDetails = (await driver.read("all", { selector: '[role="menu"] [role="menuitem"]' })).find(
    (item) => item.name === labels.finder,
  );
  assert.ok(finderDetails?.describedBy, "The disabled Finder item references an accessible explanation");
  assert.match(finderDetails.description, /remote.*(?:folder|server)|(?:folder|server).*remote/iu);
  assert.match(finderDetails.description, /copy.*path|file (?:panel|viewer)/iu);
  assert.match(finderDetails.title ?? "", /remote/iu, "The Finder reason is also available on native hover");
  const menuScreenshot = await driver.screenshot("remote-project-menu");
  clipboard.writeText("unit5-proof-copy-sentinel");
  await driver.click({ role: "menuitem", name: labels.copy, scope });
  await driver.waitFor(
    () => clipboard.readText() === fixture.project,
    "Copy remote path writes the actual canonical fixture path",
  );
  const before = await driver.read("rows");
  await driver.openMenu(views.alpha, fixture.project);
  const moves = await driver.page("elements", { role: "menuitem", scope });
  const move = moves.find((item) => ["Move up", "Move down"].includes(item.name) && !item.disabled);
  assert.ok(move, "Two mounted remote spaces can be reordered");
  await driver.click({ role: "menuitem", name: move.name, scope });
  await driver.waitFor(async () => {
    const rows = await driver.read("rows");
    return (
      rows.findIndex((item) => item.host?.name.includes(labels.alpha)) !==
      before.findIndex((item) => item.host?.name.includes(labels.alpha))
    );
  }, "the native move action reorders the unified sidebar");
  const reordered = await driver.read("rows");
  await driver.openMenu(views.alpha, fixture.project);
  await driver.click({ role: "menuitem", name: labels.serverSettings, scope });
  await driver.waitFor(
    () => driver.exists({ role: "region", name: "Settings" }),
    "server settings from the project menu",
  );
  assert.equal(await driver.page("attribute", { role: "tab", name: "Servers", attribute: "aria-selected" }), "true");
  await driver.closeSettings();
  await driver.openMenu(views.beta, fixture.project);
  await driver.click({ role: "menuitem", name: labels.remove, scope });
  await driver.waitFor(
    async () => !(await driver.row(views.beta, fixture.project)),
    "removing only the selected remote project row",
  );
  assert.ok(await driver.row(views.alpha, fixture.project), "Removing the same path on beta preserves alpha");
  await focusRemote(context);
  return {
    menuText,
    menuScreenshot,
    actionNames,
    menuItemNames: menuItems.map((item) => item.name),
    finder: {
      name: finder.name,
      disabled: finder.disabled,
      reason: finderDetails.description,
      hoverReason: finderDetails.title,
    },
    copiedPath: fixture.project,
    move: move.name,
    before,
    reordered,
    betaOnlyRemoved: true,
    nativeNewSessionTarget: labels.alpha,
  };
}

export async function verifyProjectSources(context) {
  const { driver, fixture, views } = context;
  await driver.click({ role: "button", name: "Switch or add project" });
  for (const name of [labels.local, labels.remote, labels.settings]) {
    const control = (await driver.page("elements", { role: "menuitem", name }))[0];
    assert.ok(control && !control.disabled, `${name} is an available project source`);
  }
  assert.match(await driver.page("text"), /2 online/u);
  const before = await driver.bridge("getUiState");
  await driver.click({ role: "menuitem", name: labels.remote });
  const picker = { role: "dialog", name: labels.picker };
  await driver.waitFor(() => driver.exists(picker), "the sidebar remote source opens the real picker");
  const pickerText = await driver.page("text", { scope: picker });
  assert.ok(pickerText.includes(labels.alpha) && pickerText.includes(labels.beta));
  await driver.click({ role: "button", name: "Cancel", scope: picker });
  assert.deepEqual(
    (await driver.bridge("getUiState")).projectSpaces,
    before.projectSpaces,
    "Cancelling remote browsing preserves the focused project",
  );
  await driver.click({ role: "button", name: "Switch or add project" });
  await driver.click({ role: "menuitem", name: labels.settings });
  await driver.waitFor(
    () => driver.exists({ role: "region", name: "Settings" }),
    "the sidebar settings source opens Settings",
  );
  assert.equal(await driver.page("attribute", { role: "tab", name: "Servers", attribute: "aria-selected" }), "true");
  await driver.closeSettings();
  await driver.click({ role: "button", name: "Switch or add project" });
  await driver.fill("Search or open a project…", fixture.localProject);
  await driver.waitFor(
    () => driver.exists({ role: "menuitem", name: `Open ${fixture.localProject}` }),
    "a real local directory suggestion",
  );
  await driver.key("Enter");
  await driver.waitFor(
    async () => (await driver.read("rows")).some((item) => item.path === fixture.localProject && !item.host),
    "a local path opened through native project search",
  );
  await driver.waitFor(
    async () => !(await driver.read("exists", { selector: selectors.attribution })),
    "local focus has no remote attribution",
  );
  await focusRemote(context);
  return {
    sourceChoices: [labels.local, labels.remote, labels.settings],
    onlineServers: 2,
    pickerText,
    localPathOpened: fixture.localProject,
    nativeOsFolderDialogExercised: false,
    restoredRemote: views.alpha.label,
  };
}

export async function verifyPolicyAttribution({ driver, fixture, views }) {
  const externalPolicy =
    /Independent mode is off;\s*externally managed remote services are not stopped by this desktop/iu;
  const observations = [];
  for (const detachedDaemon of [true, false]) {
    await driver.bridge("environmentCommand", { type: "set-policy", policy: { detachedDaemon, autoReconnect: true } });
    await driver.waitFor(
      () => driver.read("exists", { selector: selectors.welcome }),
      "the production welcome daemon capsule",
    );
    await driver.waitFor(async () => {
      const text = await driver.read("text", { selector: selectors.welcome });
      return detachedDaemon
        ? /independent|continue.*(?:disconnect|desktop)|close.*laptop/iu.test(text)
        : externalPolicy.test(text);
    }, `welcome copy reflects detachedDaemon=${detachedDaemon}`);
    const welcome = await driver.read("text", { selector: selectors.welcome });
    assert.ok(welcome.includes(views.alpha.label));
    if (!detachedDaemon) {
      assert.match(welcome, externalPolicy, "Disabling independent mode does not stop externally managed services");
      assert.doesNotMatch(
        welcome,
        /disconnecting or quitting the desktop app stops the remote service|tasks (?:will )?(?:continue|survive)|tasks (?:are )?not interrupted/iu,
        "The external service capsule must not claim desktop-owned shutdown or guaranteed task survival",
      );
    }
    observations.push({
      detachedDaemon,
      welcome,
      screenshot: await driver.screenshot(`welcome-detached-${detachedDaemon}`),
    });
  }
  await driver.bridge("environmentCommand", { type: "set-policy", policy: { detachedDaemon: true } });
  const topbar = await driver.read("text", { selector: selectors.topbar });
  const composer = await driver.read("text", { selector: selectors.attribution });
  assert.ok(topbar.includes(views.alpha.label));
  assert.match(topbar, /Online/u);
  assert.ok(composer.includes(views.alpha.label) && composer.includes(fixture.project));
  return { observations, topbar, composer, daemonOwnership: "external", processExitSurvivalNotClaimed: true };
}

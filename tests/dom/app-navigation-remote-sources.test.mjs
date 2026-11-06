import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  click,
  waitFor,
  visibleText,
  dom,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

test("the production remote source opens the zero-server picker and cancellation preserves the current conversation", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await click(await waitFor(() => control(scene.history(), "button", "Project release notes")));
  await waitFor(() => visibleText(scene.container, "Project conversation marker"));
  await click(control(await scene.menu("navigation-project"), "menuitem", "Add project space from remote server…"));
  const dialog = await waitFor(() => {
    const dialogs = roles(dom.window.document.body, "dialog");
    assert.equal(dialogs.length, 1);
    return dialogs[0];
  });
  assert.match(dialog.textContent, /No remote servers yet/);
  assert.match(dialog.textContent, /Add a remote server in Settings/);
  await click(control(dialog, "button", "Cancel"));
  await waitFor(() => assert.equal(roles(dom.window.document.body, "dialog").length, 0));
  visibleText(scene.container, "Project conversation marker");
  assert.equal(dom.window.location.search, "?session=project-history");
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});

test("the production switcher's server settings source opens the Servers settings page", async (t) => {
  const scene = await startNavigation(t);
  await click(control(await scene.menu(), "menuitem", "Connect a remote server…"));
  await waitFor(() => assert.equal(control(scene.container, "tab", "Servers").getAttribute("aria-selected"), "true"));
  control(scene.container, "heading", "Work locally and on multiple remote servers");
});

test("an unrelated server retry never prevents restoring an already listed local conversation", async (t) => {
  const options = { initialSession: "project-history" };
  const external = navigationBoundary(options);
  external.bridge.listEnvironments = async () => ({
    revision: 1,
    policy: { detachedDaemon: true, autoReconnect: true },
    environments: [
      {
        id: "unreachable",
        label: "Unreachable",
        enabled: true,
        target: { kind: "ssh", sshAlias: "unreachable" },
        descriptor: null,
        status: {
          phase: "backoff",
          reason: "network",
          detail: "No network",
          retryAt: Date.now() + 60000,
          failureCount: 1,
        },
      },
    ],
  });
  const scene = await startNavigation(t, options, external);
  await waitFor(() => visibleText(scene.container, "Project conversation marker"));
  assert.equal(dom.window.location.search, "?session=project-history");
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});

import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  click,
  keyDown,
  act,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { browserTab } from "../support/browser-state.mjs";

after(restoreGlobals);

const separator = (scene) => control(scene.container, "separator", "Resize right panel");
const panelButton = (scene, name) => control(scene.container, "button", name);

async function openPanel(scene, tool) {
  await click(control(scene.container, "button", "Show file panel"));
  await click(await waitFor(() => panelButton(scene, tool)));
  await waitFor(() => assert.equal(panelButton(scene, tool).getAttribute("aria-pressed"), "true"));
}

async function backToChat(scene) {
  await click(control(scene.navigation(), "button", "Chat"));
  await waitFor(() => control(scene.container, "region", "Chat"));
}

function toolsHidden(scene) {
  for (const name of ["Explorer", "Browser", "Processes"])
    assert.equal(roles(scene.container, "button", name).length, 0, `${name} is not exposed over Resources`);
  assert.equal(roles(scene.container, "separator", "Resize right panel").length, 0);
}

for (const tool of ["Explorer", "Processes"])
  test(`the open ${tool} panel steps aside for Resources and returns with the same tool and width`, async (t) => {
    const scene = await startNavigation(t, { initialSession: "personal-history" });
    await waitFor(() => control(scene.container, "region", "Chat"));
    await openPanel(scene, tool);
    await retainsToolAndWidth(scene, tool);
  });

async function retainsToolAndWidth(scene, tool) {
  const before = separator(scene).getAttribute("aria-valuenow");
  await keyDown(separator(scene), "ArrowRight");
  const resized = await waitFor(() => {
    const now = separator(scene).getAttribute("aria-valuenow");
    assert.notEqual(now, before, "the keyboard resize changed the width");
    return now;
  });
  await scene.resources();
  toolsHidden(scene);
  await backToChat(scene);
  await waitFor(() => assert.equal(panelButton(scene, tool).getAttribute("aria-pressed"), "true"));
  assert.equal(separator(scene).getAttribute("aria-valuenow"), resized);
}

test("the file panel toggle cannot lay the tools over Resources", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => control(scene.container, "region", "Chat"));
  await scene.resources();
  for (const toggle of roles(scene.container, "button", "Show file panel")) await click(toggle);
  await scene.settled();
  control(scene.container, "heading", "Plugins & Skills");
  toolsHidden(scene);
});

test("a browser authorization request answered on Resources does not bring the native view back over Resources", async (t) => {
  const scene = await startNavigation(t, {
    initialSession: "personal-history",
    browserTabs: [browserTab("shared-page")],
  });
  await waitFor(() => control(scene.container, "region", "Chat"));
  await openPanel(scene, "Browser");
  await waitFor(() => assert.equal(scene.external.nativeSurface().visible, true));
  await scene.resources();
  await waitFor(() => assert.equal(scene.external.nativeSurface().visible, false));
  await act(async () =>
    scene.external.browserEvent({
      type: "agent-authorization-request",
      request: {
        id: "retention-permission",
        sessionId: "personal-history",
        source: "local",
        minimumPermission: "read",
        createdAt: 1,
        expiresAt: 30001,
      },
    }),
  );
  await click(await waitFor(() => control(scene.container, "button", "Deny")));
  await waitFor(() => assert.equal(roles(scene.container, "button", "Deny").length, 0));
  await scene.settled();
  assert.equal(scene.external.nativeSurface().visible, false, "the answered request did not re-show the view");
  await backToChat(scene);
  await waitFor(() => assert.deepEqual(scene.external.nativeSurface(), { tabId: "shared-page", visible: true }));
});

test("tools the agent starts while Chat is shown open the panel (the events reach the App)", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => control(scene.container, "region", "Chat"));
  await act(async () => scene.external.processCreated("agent-dev-server"));
  await waitFor(() => assert.equal(panelButton(scene, "Processes").getAttribute("aria-pressed"), "true"));
  await act(async () => scene.external.browserTabCreated(browserTab("agent-page", "personal-history")));
  await waitFor(() => assert.equal(panelButton(scene, "Browser").getAttribute("aria-pressed"), "true"));
});

test("the native browser view is hidden while Resources is shown and restored for the same tab back in Chat", async (t) => {
  const scene = await startNavigation(t, {
    initialSession: "personal-history",
    browserTabs: [browserTab("shared-page")],
  });
  await waitFor(() => control(scene.container, "region", "Chat"));
  await openPanel(scene, "Browser");
  await waitFor(() => assert.deepEqual(scene.external.nativeSurface(), { tabId: "shared-page", visible: true }));
  await scene.resources();
  await waitFor(() => assert.equal(scene.external.nativeSurface().visible, false));
  await scene.settled();
  assert.equal(scene.external.nativeSurface().visible, false, "nothing re-shows the view over Resources");
  await backToChat(scene);
  await waitFor(() => assert.deepEqual(scene.external.nativeSurface(), { tabId: "shared-page", visible: true }));
  assert.equal(panelButton(scene, "Browser").getAttribute("aria-pressed"), "true");
});

test("Settings opened from the navigation hides the native browser view and closing it shows the view again", async (t) => {
  const scene = await startNavigation(t, {
    initialSession: "personal-history",
    browserTabs: [browserTab("shared-page")],
  });
  await waitFor(() => control(scene.container, "region", "Chat"));
  await openPanel(scene, "Browser");
  await waitFor(() => assert.equal(scene.external.nativeSurface().visible, true));
  const settings = await scene.settings();
  await waitFor(() => assert.equal(scene.external.nativeSurface().visible, false));
  await click(control(settings, "button", "Close"));
  await waitFor(() => assert.deepEqual(scene.external.nativeSurface(), { tabId: "shared-page", visible: true }));
});

test("tools the agent starts while Resources is shown neither take over the page nor change the saved tool selection", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => control(scene.container, "region", "Chat"));
  await scene.resources();
  await act(async () => {
    scene.external.processCreated("agent-dev-server");
    scene.external.browserTabCreated(browserTab("agent-page", "personal-history"));
  });
  await scene.settled();
  control(scene.container, "heading", "Plugins & Skills");
  toolsHidden(scene);
  assert.equal(scene.external.nativeSurface().visible, false);
  await backToChat(scene);
  await scene.settled();
  control(scene.container, "button", "Show file panel");
  toolsHidden(scene);
});

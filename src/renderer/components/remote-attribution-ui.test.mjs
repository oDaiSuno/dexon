import { attributionFixture, rootEl, restoreGlobals, createElement } from "./remote-attribution.harness.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createSessionDetail, createSessionTestHost } from "../hooks/agent-session/session-hook-harness.mjs";
import { button, click, getByRole, allByRole } from "../../../tests/support/dom-events.mjs";

after(restoreGlobals);

test("the connected welcome capsule follows the real detached daemon policy", async (t) => {
  const f = await attributionFixture(t);
  await f.focus();
  await f.render(f.api.RemoteDaemonCapsule);
  assert.match(rootEl.textContent, /gpu-a100/);
  assert.match(
    rootEl.textContent,
    /The remote daemon runs independently; closing your laptop or disconnecting does not interrupt tasks/,
  );
  await f.push({ policy: { detachedDaemon: false, autoReconnect: true } });
  assert.match(
    rootEl.textContent,
    /Independent mode is off; disconnecting or quitting the desktop app stops the remote service/,
  );
  assert.doesNotMatch(rootEl.textContent, /does not interrupt tasks/);
  await f.status({ phase: "offline", lastFailure: null });
  assert.equal(rootEl.textContent, "", "a disconnected environment must not show the green connected capsule");
});

test("a zero-second reconnect banner stays visible and reconnects through the environment command", async (t) => {
  const f = await attributionFixture(t);
  await f.focus();
  await f.status({ phase: "backoff", retryAt: 10_000, failureCount: 2, reason: "network", detail: "connection lost" });
  await f.render(f.api.ReconnectBanner);
  assert.match(rootEl.textContent, /gpu-a100/);
  assert.match(rootEl.textContent, /0 seconds \(attempt 3\)/);
  await click(button(rootEl, "Reconnect now"));
  assert.deepEqual(f.commands, [{ type: "connect", environmentId: "remote-a" }]);
  await f.status({ phase: "connected", generation: 2, since: 10_000 });
  assert.equal(rootEl.textContent, "");
  await f.status({ phase: "connecting", stage: "synchronizing", attempt: 1, progress: null });
  assert.match(rootEl.textContent, /Connecting to gpu-a100/);
});

test("the top bar and composer update together without changing their parent props", async (t) => {
  const f = await attributionFixture(t);
  function Page() {
    return createElement(
      "main",
      null,
      createElement(f.api.TopBar, {
        sidebarOpen: true,
        onToggleSidebar() {},
        showSidebarToggle: false,
        isMobile: false,
        selectedSession: null,
        projectName: "shared",
        activeTopPanel: null,
        onToggleTopPanel() {},
        sessionStats: null,
        contextUsage: null,
        modelId: null,
        copyFeedback: null,
        onCopyField() {},
        showChat: true,
      }),
      createElement(f.api.ComposerEnvironmentStrip),
    );
  }
  await f.focus();
  await f.render(Page);
  const top = () => getByRole(rootEl, "status", "Server connection");
  const strip = () => getByRole(rootEl, "status", "Send destination");
  assert.match(top().textContent, /gpu-a100.*Online/);
  assert.match(strip().textContent, /Current send destination: remote server gpu-a100/);
  assert.match(strip().textContent, /~\/shared/);
  await f.status({ phase: "backoff", retryAt: 12_000, failureCount: 1, reason: "network", detail: "lost" });
  assert.match(top().textContent, /gpu-a100.*Reconnecting/);
  assert.match(strip().textContent, /Reconnecting.*Draft saved automatically/);
  await f.focus("remote-b");
  assert.match(top().textContent, /gpu-b200.*Online/);
  assert.match(strip().textContent, /remote server gpu-b200/);
  await f.focus("primary");
  assert.doesNotMatch(rootEl.textContent, /gpu-a100|gpu-b200|Current send destination/);
});

test("the actual chat window puts the reconnect banner above the conversation", async (t) => {
  const f = await attributionFixture(
    t,
    'export { ChatWindow } from "./components/ChatWindow.tsx";' +
      'export { ThinkingExpansionStore } from "./lib/thinking-expansion-store.ts";',
  );
  const detail = createSessionDetail("banner-location");
  f.serve("remote-a", createSessionTestHost({ getSession: async () => detail }));
  f.api.environmentRegistry.registerSession("remote-a", detail.info.id);
  await f.focus();
  await f.render(f.api.ChatWindow, {
    session: { ...detail.info, environmentId: "remote-a" },
    newSessionCwd: null,
    thinkingExpansionStore: new f.api.ThinkingExpansionStore(),
    processDetailsExpansionStore: new f.api.ThinkingExpansionStore(),
  });
  await f.flush();
  await f.status({ phase: "backoff", retryAt: 13_000, failureCount: 1, reason: "network", detail: "lost" });
  const conversation = getByRole(rootEl, "region", "Conversation");
  const banner = allByRole(rootEl, "status").find((node) => /Connection to gpu-a100/.test(node.textContent));
  assert.ok(banner);
  assert.ok(banner.compareDocumentPosition(conversation) & 4, "the warning must precede the conversation");
});

test("a disconnected banner describes the policy without claiming unobserved remote tasks are still running", async (t) => {
  const f = await attributionFixture(t);
  await f.focus();
  await f.status({ phase: "offline", lastFailure: null });
  await f.render(f.api.ReconnectBanner);
  assert.match(rootEl.textContent, /Disconnected from gpu-a100/);
  assert.match(rootEl.textContent, /remote service status will be confirmed after reconnecting/);
  assert.doesNotMatch(rootEl.textContent, /tasks continue running|does not interrupt tasks/);
  await f.push({ policy: { detachedDaemon: false, autoReconnect: false } });
  assert.match(
    rootEl.textContent,
    /Independent mode is off; disconnecting or quitting the desktop app stops the remote service/,
  );
  await click(button(rootEl, "Reconnect now"));
  assert.deepEqual(f.commands, [{ type: "connect", environmentId: "remote-a" }]);
});

test("opening an unavailable remote session still shows the reconnect action and retained disabled composer", async (t) => {
  const f = await attributionFixture(
    t,
    'export { ChatWindow } from "./components/ChatWindow.tsx";' +
      'export { ThinkingExpansionStore } from "./lib/thinking-expansion-store.ts";',
  );
  const detail = createSessionDetail("offline-session-window");
  f.api.environmentRegistry.registerSession("remote-a", detail.info.id);
  f.api.setDraft(detail.info.id, { value: "saved remote session draft" });
  await f.focus();
  await f.status({ phase: "offline", lastFailure: null });
  await f.render(f.api.ChatWindow, {
    session: { ...detail.info, environmentId: "remote-a" },
    newSessionCwd: null,
    thinkingExpansionStore: new f.api.ThinkingExpansionStore(),
    processDetailsExpansionStore: new f.api.ThinkingExpansionStore(),
  });
  await f.flush();
  assert.match(rootEl.textContent, /Disconnected from gpu-a100/);
  assert.ok(button(rootEl, "Reconnect now"));
  assert.equal(button(rootEl, "Waiting to reconnect…")?.disabled, true);
  assert.match(rootEl.textContent, /saved remote session draft/);
  f.serve("remote-a", createSessionTestHost({ getSession: async () => detail }));
  await f.status({ phase: "connected", generation: 1, since: 10_000 });
  await f.flush();
  assert.equal(button(rootEl, "Send")?.disabled, false);
  assert.match(rootEl.textContent, /saved remote session draft/);
});

test("the blocked diagnosis action opens the actual Servers settings through the existing dialog owner", async (t) => {
  const f = await attributionFixture(
    t,
    'export { useSettingsDialog } from "./components/app-shell/use-settings-dialog.ts";' +
      'export { SettingsConfig } from "./components/SettingsConfig.tsx";',
  );
  await f.focus();
  await f.status({
    phase: "blocked",
    diagnosis: { reason: "authentication", detail: "An SSH key is required", copyIdCommand: null },
  });
  function Page() {
    const settings = f.api.useSettingsDialog();
    return createElement(
      "main",
      null,
      createElement(f.api.ReconnectBanner),
      settings.settingsOpen &&
        createElement(f.api.SettingsConfig, {
          cwd: null,
          sessionId: null,
          initialTab: settings.settingsInitialTab,
          navigationRequestId: settings.settingsNavigationRequestId,
          onClose: settings.closeSettings,
          onModelsChanged() {},
          chatAppearance: { fontSize: "standard", layout: "fixed" },
          chatAppearanceSaving: false,
          async onChatAppearanceChange() {},
        }),
    );
  }
  await f.render(Page);
  assert.match(rootEl.textContent, /An SSH key is required/);
  assert.doesNotMatch(rootEl.textContent, /tasks continue running|does not interrupt tasks/);
  await click(button(rootEl, "View diagnosis"));
  assert.equal(rootEl.querySelector('[role="tab"][aria-selected="true"]')?.textContent, "Servers");
  assert.ok(rootEl.querySelector('[role="region"][aria-label="Settings"]'));
  assert.equal(
    f.commands.some((command) => command.type === "connect"),
    false,
  );
});

test("an available but never connected remote is not described as a lost connection", async (t) => {
  const f = await attributionFixture(t);
  await f.focus();
  await f.status({ phase: "available" });
  await f.render(f.api.ReconnectBanner);
  assert.match(rootEl.textContent, /Not connected to gpu-a100/);
  assert.doesNotMatch(rootEl.textContent, /Disconnected from gpu-a100/);
  await click(button(rootEl, "Reconnect now"));
  assert.deepEqual(f.commands, [{ type: "connect", environmentId: "remote-a" }]);
});

test("desktop shutdown policy does not claim to stop an externally managed remote service", async (t) => {
  const f = await attributionFixture(t);
  await f.focus();
  await f.push({
    policy: { detachedDaemon: false, autoReconnect: true },
    environments: f.api.environmentRegistry.getSnapshot().environments.map((view) => ({
      ...view,
      runtime: {
        nodeVersion: "22.23.3",
        payloadVersion: "0.3.3",
        startedAt: 0,
        ownership: "external",
        updatePending: false,
      },
    })),
  });
  await f.render(f.api.RemoteDaemonCapsule);
  assert.match(rootEl.textContent, /externally managed remote services are not stopped by this desktop/);
  await f.status({ phase: "offline", lastFailure: null });
  await f.render(f.api.ReconnectBanner);
  assert.match(rootEl.textContent, /externally managed remote services are not stopped by this desktop/);
  assert.doesNotMatch(rootEl.textContent, /stops the remote service/);
});

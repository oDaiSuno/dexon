import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, dom, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import { click, control, roles } from "../support/app-navigation.mjs";
import { input, keyDown } from "../support/dom-events.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";
import { installHostBridge } from "../support/host-bridge.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P, startedConversation } from "../fixtures/app-navigation-data.mjs";
import {
  folderListing,
  remoteServer,
} from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "app-file-selection-environments",
  'export {App} from "./src/renderer/App.tsx"; export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts"; export {getEnvironmentApiClient} from "./src/renderer/lib/api-client.ts";',
);
after(restoreGlobals);

async function start(t, remoteCwd, { primaryCwd = P.project, projectRoot, initialNew = false } = {}) {
  dom.window.localStorage.clear();
  dom.window.history.replaceState(null, "", initialNew ? "/" : "/?session=primary-file-session");
  api.setAppLanguage("en-US");
  const primary = navigationBoundary({ history: false, lastSpaceCwd: primaryCwd, openProjects: [primaryCwd, P.other] });
  const remote = navigationBoundary({ history: false });
  const primarySession = startedConversation("primary-file-session", primaryCwd, "Primary file session marker");
  const remoteSession = startedConversation("remote-file-session", remoteCwd, "Remote file session marker");
  if (projectRoot) {
    primarySession.info.projectRoot = projectRoot;
    remoteSession.info.projectRoot = projectRoot;
  }
  primary.addConversation(primarySession);
  primary.addConversation(startedConversation("primary-other-session", P.other, "Other local session marker"));
  remote.addConversation(remoteSession);
  remote.addConversation(startedConversation("remote-other-session", P.other, "Other remote session marker"));
  const filesHost = (external, environmentId) => ({
    ...external.host,
    call(method, params) {
      if (method === "projects.browse") return folderListing(params.path ?? primaryCwd);
      if (method === "files.list") return { entries: [{ name: "selected.txt", isDir: false, size: 1 }] };
      if (method === "files.read") {
        const content = `${environmentId} selected content at ${params.path}`;
        return { content, encoding: "utf8", language: "text", size: content.length };
      }
      return external.host.call(method, params);
    },
  });
  const remoteTarget = { piBridge: {} };
  const remoteBoundary = installHostBridge(remoteTarget, filesHost(remote, "gpu"));
  const boundary = installRendererApi(dom.window, api, () => filesHost(primary, "primary"), {
    bridge: {
      ...primary.bridge,
      listEnvironments: async () => ({
        revision: 1,
        policy: { detachedDaemon: true, autoReconnect: true },
        environments: [remoteServer("gpu")],
      }),
      onEnvironmentsChanged: () => () => {},
      requestEnvironmentPort: () => remoteTarget.piBridge.requestHostPort(),
    },
  });
  const listeners = new Set();
  const add = dom.window.addEventListener;
  const remove = dom.window.removeEventListener;
  dom.window.addEventListener = (type, listener, options) => {
    if (type === "message") listeners.add(listener);
    add(type, listener, options);
  };
  dom.window.removeEventListener = (type, listener, options) => {
    if (type === "message") listeners.delete(listener);
    remove(type, listener, options);
  };
  remoteTarget.addEventListener("message", (event) => {
    for (const listener of listeners) {
      listener({
        source: dom.window,
        data: { channel: "dexon-host-port", environmentId: "gpu", generation: 1 },
        ports: event.ports,
      });
    }
  });
  let view;
  t.after(async () => {
    await view?.unmount();
    dom.window.addEventListener = add;
    dom.window.removeEventListener = remove;
    boundary.close();
    remoteBoundary.close();
    primary.releaseHolds();
    remote.releaseHolds();
    assert.deepEqual(primary.unexpected, []);
    assert.deepEqual(remote.unexpected, []);
  });
  await act(async () => api.environmentRegistry.initialize());
  view = await mount(t, api.App);
  await waitFor(() => control(view.container, "button", "Show file panel"), { timeout: 10_000 });
  if (initialNew) await waitFor(() => control(control(view.container, "group", "Message input"), "textbox"));
  else await waitFor(() => assert.match(view.container.textContent, /Primary file session marker/));
  await act(async () => {
    await api.getEnvironmentApiClient("gpu").listSessions();
  });
  await click(control(view.container, "button", "Show file panel"));
  await waitFor(() => control(view.container, "button", "Open file selected.txt"));
  assert.deepEqual(primary.unexpected, []);
  assert.deepEqual(remote.unexpected, []);
  return {
    ...view,
    requests: (environmentId, method) => (environmentId === "primary" ? primary : remote).requests(method),
    async focus(sessionId, marker) {
      await act(async () => primary.deepLink(sessionId));
      await waitFor(() => assert.match(view.container.textContent, marker));
    },
    async open(environmentId, cwd) {
      const file = await waitFor(() => control(view.container, "button", "Open file selected.txt"));
      assert.equal(file.title, `${cwd}/selected.txt`);
      await click(file);
      await this.selected(environmentId, cwd);
    },
    async selected(environmentId, cwd) {
      await waitFor(() =>
        assert.equal(control(view.container, "button", "selected.txt").getAttribute("aria-current"), "page"),
      );
      assert.equal(control(view.container, "button", "selected.txt").title, `${cwd}/selected.txt`);
      await waitFor(() =>
        assert.match(
          view.container.textContent,
          new RegExp(`${environmentId} selected content at ${cwd}/selected.txt`),
        ),
      );
      assert.equal(roles(view.container, "button", "Open file selected.txt").length, 0);
    },
  };
}

async function typeDraft(editor, value) {
  await act(async () => {
    editor.focus();
    editor.textContent = value;
    const range = dom.window.document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    editor.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
}

test("mounting a remote folder keeps its draft and first prompt on that server", async (t) => {
  const scene = await start(t, P.project, { initialNew: true });
  const composer = () => control(control(scene.container, "group", "Message input"), "textbox");
  await waitFor(() =>
    assert.equal(control(scene.container, "button", "Open file selected.txt").title, `${P.project}/selected.txt`),
  );
  await typeDraft(composer(), "local-only unsent message");
  await waitFor(() => assert.equal(composer().textContent, "local-only unsent message"));
  await click(control(scene.container, "button", "Switch or add project"));
  await click(control(dom.window.document.body, "menuitem", "Add project space from remote server…"));
  const dialog = await waitFor(() => control(dom.window.document.body, "dialog"));
  await input(control(dialog, "textbox", "Remote folder path"), P.project);
  await keyDown(control(dialog, "textbox", "Remote folder path"), "Enter");
  await waitFor(() => assert.equal(control(dialog, "button", "Mount project space").disabled, false));
  await click(control(dialog, "button", "Mount project space"));
  await waitFor(() => assert.equal(roles(dom.window.document.body, "dialog").length, 0));
  await waitFor(() => assert.equal(composer().textContent, "", "the remote destination has its own draft"));
  await typeDraft(composer(), "remote-only prompt");
  await click(control(control(scene.container, "group", "Message input"), "button", "Send"));
  await waitFor(() =>
    assert.deepEqual(
      { remote: scene.requests("gpu", "agent.new").length, local: scene.requests("primary", "agent.new").length },
      { remote: 1, local: 0 },
    ),
  );
  assert.equal(scene.requests("gpu", "agent.new")[0].cwd, P.project);
  assert.equal(scene.requests("primary", "agent.new").length, 0);
});

test("the actual App restores each environment's selected file when both environments have the same cwd", async (t) => {
  const scene = await start(t, P.project);
  await scene.open("primary", P.project);
  await scene.focus("remote-file-session", /Remote file session marker/);
  await scene.open("gpu", P.project);
  await scene.focus("primary-file-session", /Primary file session marker/);
  await scene.selected("primary", P.project);
  await scene.focus("remote-file-session", /Remote file session marker/);
  await scene.selected("gpu", P.project);
});

test("the actual App restores file selection across environments with different cwd values and delayed directory echoes", async (t) => {
  const scene = await start(t, P.other);
  await scene.open("primary", P.project);
  await scene.focus("remote-file-session", /Remote file session marker/);
  await scene.open("gpu", P.other);
  await scene.focus("primary-file-session", /Primary file session marker/);
  await scene.selected("primary", P.project);
  await scene.focus("remote-file-session", /Remote file session marker/);
  await scene.selected("gpu", P.other);
});

test("a real cwd change inside the returned environment still selects Explorer and keeps its file tab", async (t) => {
  const scene = await start(t, P.project);
  await scene.open("primary", P.project);
  await scene.focus("remote-file-session", /Remote file session marker/);
  await scene.open("gpu", P.project);
  await scene.focus("primary-file-session", /Primary file session marker/);
  await scene.selected("primary", P.project);
  await scene.focus("primary-other-session", /Other local session marker/);
  await waitFor(() =>
    assert.equal(control(scene.container, "button", "Explorer").getAttribute("aria-pressed"), "true"),
  );
  await waitFor(() =>
    assert.equal(control(scene.container, "button", "Open file selected.txt").title, `${P.other}/selected.txt`),
  );
  assert.equal(control(scene.container, "button", "selected.txt").getAttribute("aria-current"), null);
  assert.equal(control(scene.container, "button", "selected.txt").title, `${P.project}/selected.txt`);
});

test("same-path worktree sessions adopt their cwd rather than the project root and still explore the next remote cwd change", async (t) => {
  const scene = await start(t, P.worktree, { primaryCwd: P.worktree, projectRoot: P.project });
  await scene.open("primary", P.worktree);
  await scene.focus("remote-file-session", /Remote file session marker/);
  await scene.open("gpu", P.worktree);
  await scene.focus("primary-file-session", /Primary file session marker/);
  await scene.selected("primary", P.worktree);
  await scene.focus("remote-file-session", /Remote file session marker/);
  await scene.selected("gpu", P.worktree);
  await scene.focus("remote-other-session", /Other remote session marker/);
  await waitFor(() =>
    assert.equal(control(scene.container, "button", "Explorer").getAttribute("aria-pressed"), "true"),
  );
  await waitFor(() =>
    assert.equal(control(scene.container, "button", "Open file selected.txt").title, `${P.other}/selected.txt`),
  );
  assert.equal(control(scene.container, "button", "selected.txt").getAttribute("aria-current"), null);
});

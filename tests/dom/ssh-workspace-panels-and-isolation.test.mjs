import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  control,
  dom,
  hover,
  roles,
  startNavigation,
  visibleText,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { installBrowserEvents } from "../support/app-navigation-workspace.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P, startedConversation } from "../fixtures/app-navigation-data.mjs";
import { remoteHostBoundary } from "../support/api-host.mjs";

after(restoreGlobals);
after(installBrowserEvents());

const REMOTE = "ssh://ubuntu@prod-vps/home/ubuntu/work/app";
const FILE = `${REMOTE}/src/db/pool.ts`;
const CONTENT = "export const poolSize = 14;";

function snapshot(patch = {}) {
  return {
    workspace: REMOTE,
    hostLabel: "prod-vps",
    authorityLabel: "ubuntu@prod-vps",
    remotePath: "/home/ubuntu/work/app",
    connection: "connected",
    workspaceTrust: "trusted",
    trustRevision: 1,
    remoteSkillCount: 2,
    localSkillCount: 12,
    ruleLens: {
      localAgentsMd: true,
      localSkillCount: 12,
      credentialsBlocked: true,
      remoteAgentsMdPaths: [],
      remoteSkillCount: 2,
      ancestorBoundary: "git-root",
      boundaryPath: "/home/ubuntu/work/app",
      syncedAt: 1,
    },
    containment: { state: "verified-clean", activeRemoteProcessCount: 0 },
    ...patch,
  };
}

async function fileScene(t, script = {}, options = {}) {
  const settings = {
    history: false,
    initialSession: "ssh-files",
    openProjects: [P.personal, REMOTE],
    ...options,
  };
  const base = navigationBoundary(settings);
  base.addConversation(startedConversation("ssh-files", REMOTE, "Inspect the remote connection pool"));
  let external;
  external = remoteHostBoundary(base, {
    "remote.workspacesSnapshot": { states: { [REMOTE]: snapshot() } },
    "skills.list": () => ({ skills: [] }),
    "files.list": ({ path }) => {
      const folders = {
        [REMOTE]: [{ name: "src", type: "directory", isDir: true }],
        [`${REMOTE}/src`]: [{ name: "db", type: "directory", isDir: true }],
        [`${REMOTE}/src/db`]: [{ name: "pool.ts", type: "file", isDir: false }],
      };
      return { entries: folders[path] ?? [] };
    },
    "files.read": () => ({
      content: CONTENT,
      language: "typescript",
      size: CONTENT.length,
      space: "remote",
      remoteHostLabel: "prod-vps",
    }),
    "files.watchStart": ({ path }) => {
      external.emitFileEvent({ path, event: "connected" });
      return { ok: true };
    },
    ...script,
  });
  const scene = await startNavigation(t, settings, external);
  await scene.settled();
  await click(control(scene.container, "button", "Show file panel"));
  return scene;
}

async function openPool(scene) {
  for (const name of ["src", "db"]) {
    await click(await waitFor(() => control(scene.container, "button", `Expand folder ${name}`)));
  }
  const file = await waitFor(() => control(scene.container, "button", "Open file pool.ts"));
  await click(file);
  await waitFor(() => visibleText(scene.container, CONTENT));
}

function nativeEditing(t) {
  const document = dom.window.document;
  const original = Object.getOwnPropertyDescriptor(document, "execCommand");
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value(command, _ui, markup) {
      const selection = dom.window.getSelection();
      if (!selection.rangeCount || command !== "insertHTML") return false;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const fragment = range.createContextualFragment(markup);
      const last = fragment.lastChild;
      range.insertNode(fragment);
      if (last) range.setStartAfter(last);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(document, "execCommand", original);
    else delete document.execCommand;
  });
}

test("when an SSH explorer opens its header shows host and path and expanding opening highlighting and mentioning use canonical remote keys", async (t) => {
  nativeEditing(t);
  const scene = await fileScene(t);
  visibleText(scene.container, "prod-vps:/home/ubuntu/work/app");
  await openPool(scene);
  assert.deepEqual(scene.external.requests("files.read"), [{ path: FILE, sourceSessionId: undefined }]);
  assert.deepEqual(scene.external.desktop.openedFiles, []);
  await click(control(scene.container, "button", "Explorer"));
  for (const name of ["src", "db"]) {
    await click(await waitFor(() => control(scene.container, "button", `Expand folder ${name}`)));
  }
  const current = control(scene.container, "button", "Open file pool.ts");
  assert.equal(current.getAttribute("aria-current"), "true");
  assert.equal(current.title, FILE);
  await hover(current);
  await click(control(scene.container, "button", "mention"));
  const composer = control(control(scene.container, "region", "Chat"), "textbox");
  assert.equal(control(composer, "button", "pool.ts").title, "src/db/pool.ts");
  assert.doesNotMatch(composer.textContent, /ssh:\/\//);
  assert.deepEqual(
    [...new Set(scene.external.requests("files.list").map((request) => request.path))],
    [REMOTE, `${REMOTE}/src`, `${REMOTE}/src/db`],
  );
});

test("when a watched remote file disconnects it stays readable as an offline snapshot and reconnect reloads and watches the latest content", async (t) => {
  let current = CONTENT;
  const scene = await fileScene(t, {
    "files.read": () => ({
      content: current,
      language: "typescript",
      size: current.length,
      space: "remote",
      remoteHostLabel: "prod-vps",
    }),
  });
  await openPool(scene);
  await waitFor(() => visibleText(scene.container, "Live · prod-vps"));
  const watches = scene.external.requests("files.watchStart").filter((request) => request.path === FILE).length;
  await act(async () =>
    scene.external.emitWorkspaceState({ workspace: REMOTE, state: snapshot({ connection: "offline" }) }),
  );
  visibleText(scene.container, "Offline snapshot (read-only)");
  visibleText(scene.container, CONTENT);
  current = "export const poolSize = 28;";
  await act(async () => scene.external.emitWorkspaceState({ workspace: REMOTE, state: snapshot() }));
  await waitFor(() => visibleText(scene.container, current));
  await waitFor(() => visibleText(scene.container, "Live · prod-vps"));
  assert.ok(scene.external.requests("files.watchStart").filter((request) => request.path === FILE).length > watches);
});

test("when a remote file watch errors and a refresh fails its last good content remains in the offline viewer", async (t) => {
  let readable = true;
  const scene = await fileScene(t, {
    "files.read": () => {
      if (!readable) throw new Error("Remote file is unreachable");
      return { content: CONTENT, language: "typescript", space: "remote", remoteHostLabel: "prod-vps" };
    },
  });
  await openPool(scene);
  readable = false;
  await act(async () => {
    scene.external.emitFileEvent({ path: FILE, event: "change" });
    scene.external.emitFileEvent({ path: FILE, event: "error", message: "SSH disconnected" });
  });
  await scene.settled();
  visibleText(scene.container, "Offline snapshot (read-only)");
  visibleText(scene.container, CONTENT);
  assert.doesNotMatch(scene.container.textContent, /Remote file is unreachable/);
});

test("when a file response belongs to the local overlay its lamp names the local read-only layer rather than its remote-looking request path", async (t) => {
  const scene = await fileScene(t, {
    "files.read": { content: CONTENT, language: "typescript", space: "local-overlay" },
  });
  await openPool(scene);
  visibleText(scene.container, "💻 Local read-only layer");
  assert.equal(roles(scene.container, "status", "Offline snapshot (read-only)").length, 0);
});

test("when a local file is watched and its watch fails its existing live and static labels remain unchanged", async (t) => {
  const localFile = `${P.project}/notes.txt`;
  const scene = await fileScene(
    t,
    {
      "files.list": () => ({ entries: [{ name: "notes.txt", type: "file", isDir: false }] }),
      "files.read": { content: CONTENT, language: "text", space: "local" },
    },
    { history: true, initialSession: "project-history", openProjects: [P.personal, P.project, REMOTE] },
  );
  await click(control(scene.container, "button", "Open file notes.txt"));
  await waitFor(() => visibleText(scene.container, "live"));
  await act(async () => scene.external.emitFileEvent({ path: localFile, event: "error" }));
  visibleText(scene.container, "static");
  assert.doesNotMatch(scene.container.textContent, /Offline snapshot|Local read-only layer|Live ·/);
});

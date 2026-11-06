import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  dom,
  button,
  click,
  input,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
  act,
} from "../../../../tests/support/renderer.mjs";
import { createFolderBrowserHost, remoteServer, folderListing, deferred } from "./folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "remote-folder-picker-dialog",
  `
  export { RemoteFolderPickerDialog } from "./src/renderer/components/remote-folder-picker/remote-folder-picker-dialog.tsx";
  export { workspaceStore } from "./src/renderer/lib/workspace-store.ts";
  export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";
`,
);
after(restoreGlobals);

async function openPicker(t, options = {}) {
  const host = await createFolderBrowserHost(api, { ...options, target: dom.window });
  let closed = 0;
  let settings = 0;
  const view = await mount(
    t,
    api.RemoteFolderPickerDialog,
    {
      initialEnvironmentId: options.initialEnvironmentId,
      onClose: () => {
        closed += 1;
      },
      onOpenSettings: () => {
        settings += 1;
      },
    },
    { release: host.close },
  );
  return { ...host, ...view, closed: () => closed, settings: () => settings };
}

test("the zero-server dialog sends the user to settings without mounting or closing implicitly", async (t) => {
  const picker = await openPicker(t, { servers: [] });
  const dialog = picker.container.querySelector("[role='dialog']");
  assert.ok(dialog, "the accessible dialog opens");
  assert.match(dialog.textContent, /No remote servers yet/);
  await click(button(dialog, "Add a remote server in Settings"));
  assert.equal(picker.settings(), 1);
  assert.equal(picker.closed(), 0);
  assert.deepEqual(picker.requests, []);
  assert.deepEqual(picker.writes, []);
});

test("selecting a verified remote child preserves the open chat until confirmation mounts its canonical path", async (t) => {
  const entry = { name: "app", path: "/srv/app", displayPath: "~/app", git: { branch: "main", detached: false } };
  const serverId = "8e4bb043-ec67-462e-b0c7-e037a478ec95";
  const picker = await openPicker(t, {
    servers: [{ ...remoteServer(serverId), label: "Training GPU" }],
    reply: (_id, method, params) => {
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      return params.path === "~"
        ? folderListing("/home/dev", { folders: [entry] })
        : folderListing("/srv/app", { displayPath: "~/app", git: entry.git });
    },
  });
  const before = structuredClone(api.workspaceStore.getSnapshot());
  assert.ok(button(picker.container, "Select folder app"), "folders are selectable with native buttons");
  assert.match(picker.container.textContent, /git · main/);
  await click(button(picker.container, "Select folder app"));
  assert.match(picker.container.textContent, /This folder has no subfolders/);
  const target = picker.container.querySelector("footer .type-mono-meta");
  assert.equal(target.textContent, "Training GPU:~/app");
  assert.equal(target.title, "Training GPU:/srv/app");
  assert.doesNotMatch(picker.container.querySelector("footer").outerHTML, new RegExp(serverId));
  assert.deepEqual(api.workspaceStore.getSnapshot(), before);
  assert.deepEqual(picker.writes, []);
  assert.equal(
    picker.requests.some((request) => request.method === "system.validateCwd"),
    false,
  );
  await click(button(picker.container, "Mount project space"));
  assert.equal(picker.closed(), 1);
  assert.equal(api.workspaceStore.getSnapshot().focus.environmentId, serverId);
  assert.deepEqual(
    api.workspaceStore
      .getSnapshot()
      .spaces.map(({ environmentId, path, displayPath }) => ({ environmentId, path, displayPath })),
    [{ environmentId: serverId, path: "/srv/app", displayPath: "~/app" }],
  );
  assert.deepEqual(picker.requests.at(-1), {
    environmentId: serverId,
    method: "system.validateCwd",
    params: { path: "/srv/app" },
  });
});

test("a rejected or failed mount keeps the dialog and open chat unchanged with inline feedback", async (t) => {
  let validation = "invalid";
  const picker = await openPicker(t, {
    servers: [remoteServer("gpu")],
    reply: (_id, method) => {
      if (method === "projects.browse") return folderListing("/home/dev");
      if (validation === "error") throw new Error("connection lost");
      return { ok: false, error: "not-found" };
    },
  });
  const before = structuredClone(api.workspaceStore.getSnapshot());
  await click(button(picker.container, "Mount project space"));
  assert.match(picker.container.querySelector("[role='alert']")?.textContent ?? "", /This folder could not be mounted/);
  assert.equal(picker.closed(), 0);
  validation = "error";
  await click(button(picker.container, "Mount project space"));
  assert.match(picker.container.querySelector("[role='alert']")?.textContent ?? "", /Could not mount this folder/);
  assert.equal(picker.closed(), 0);
  assert.deepEqual(api.workspaceStore.getSnapshot(), before);
  assert.deepEqual(picker.writes, []);
});

test("mounting blocks navigation and settings until validation finishes, then allows recovery", async (t) => {
  const pending = deferred();
  const picker = await openPicker(t, {
    servers: [remoteServer("gpu"), remoteServer("staging", { phase: "offline", lastFailure: null })],
    reply: (_id, method) =>
      method === "system.validateCwd"
        ? pending.promise
        : folderListing("/home/dev", {
            folders: [{ name: "project", path: "/home/dev/project", displayPath: "~/project", git: null }],
          }),
  });
  const before = structuredClone(api.workspaceStore.getSnapshot());
  await click(button(picker.container, "Mount project space"));
  try {
    for (const label of [
      "Server settings ↗",
      "Cancel",
      "Select server gpu",
      "Select server staging",
      "Connect now",
      "+ Connect a new remote server ↗",
      "Home (~)",
      "Go ↵",
      "Select folder project",
      "Open folder project",
    ]) {
      assert.equal(button(picker.container, label).disabled, true, `${label} stays disabled while mounting`);
    }
    assert.equal(picker.container.querySelector("input[aria-label='Remote folder path']").disabled, true);
    assert.ok([...picker.container.querySelectorAll("nav button")].every((control) => control.disabled));
    await keyDown(picker.container.querySelector("[role='dialog']"), "Escape");
    assert.equal(picker.settings(), 0);
    assert.equal(picker.closed(), 0);
    assert.deepEqual(api.workspaceStore.getSnapshot(), before);
    assert.deepEqual(picker.writes, []);
  } finally {
    await act(async () => pending.resolve({ ok: false, error: "not-found" }));
  }
  assert.equal(button(picker.container, "Server settings ↗").disabled, false);
  assert.equal(button(picker.container, "Cancel").disabled, false);
  await click(button(picker.container, "Server settings ↗"));
  assert.equal(picker.settings(), 1);
  assert.equal(picker.closed(), 0);
});

test("direct paths, home and breadcrumb buttons browse only the chosen server and failed paths disable confirmation", async (t) => {
  const picker = await openPicker(t, {
    initialEnvironmentId: "staging",
    reply: (_id, _method, params) => {
      if (params.path === "/root/secret") return { ok: false, path: params.path, error: "permission-denied" };
      if (params.path === "/missing") return { ok: false, path: params.path, error: "not-found" };
      return folderListing(params.path === "~" ? "/home/dev" : params.path);
    },
  });
  const field = picker.container.querySelector("input[aria-label='Remote folder path']");
  assert.ok(field, "the path bar accepts a direct remote path");
  await input(field, "/root/secret");
  await keyDown(field, "Enter");
  assert.match(picker.container.textContent, /You do not have permission to read this folder/);
  assert.equal(field.getAttribute("aria-invalid"), "true");
  assert.equal(button(picker.container, "Mount project space").disabled, true);
  await input(field, "/missing");
  await click(button(picker.container, "Go ↵"));
  assert.match(picker.container.textContent, /This folder does not exist on the server/);
  await click(button(picker.container, "Home (~)"));
  assert.equal(field.value, "~");
  assert.equal(button(picker.container, "Mount project space").disabled, false);
  await input(field, "/home/dev/workspace/app");
  await keyDown(field, "Enter");
  await click(button(picker.container.querySelector("nav"), "workspace"));
  assert.equal(picker.requests.at(-1).params.path, "~/workspace");
  assert.ok(
    picker.requests.every((request) => request.environmentId === "staging" && request.method === "projects.browse"),
  );
  assert.equal(api.workspaceStore.getSnapshot().focus.sessionId, "open-chat");
  assert.deepEqual(picker.writes, []);
});

test("a mistyped path keeps both folder columns available for recovery while showing its error and disabling mount", async (t) => {
  const workspace = { name: "workspace", path: "/home/dev/workspace", displayPath: "~/workspace", git: null };
  const app = { name: "app", path: "/home/dev/workspace/app", displayPath: "~/workspace/app", git: null };
  const picker = await openPicker(t, {
    servers: [remoteServer("gpu")],
    reply: (_id, _method, params) => {
      if (params.path === "~/workspcae") return { ok: false, path: params.path, error: "not-found" };
      return params.path === "~"
        ? folderListing("/home/dev", { folders: [workspace] })
        : folderListing("/home/dev/workspace", { folders: [app] });
    },
  });
  await click(button(picker.container, "Select folder workspace"));
  const before = structuredClone(api.workspaceStore.getSnapshot());
  const field = picker.container.querySelector("input[aria-label='Remote folder path']");
  await input(field, "~/workspcae");
  await keyDown(field, "Enter");
  assert.match(
    picker.container.querySelector("[role='alert']").textContent,
    /This folder does not exist on the server/,
  );
  const lists = [...picker.container.querySelectorAll("[aria-label='Remote folder browser'] ul")];
  assert.deepEqual(
    lists.map((list) => list.getAttribute("aria-label")),
    ["~", "~/workspace"],
  );
  assert.ok(button(lists[0], "Select folder workspace"));
  assert.ok(button(lists[1], "Select folder app"));
  assert.equal(button(picker.container, "Mount project space").disabled, true);
  assert.equal(field.value, "~/workspcae");
  assert.deepEqual(api.workspaceStore.getSnapshot(), before);
  assert.deepEqual(picker.writes, []);
  await click(button(picker.container, "Home (~)"));
  assert.equal(field.value, "~");
  assert.equal(button(picker.container, "Mount project space").disabled, false);
});

test("selecting and connecting an offline server never moves the workspace and opens that server home after connection", async (t) => {
  const offline = remoteServer("staging", { phase: "offline", lastFailure: null });
  const picker = await openPicker(t, { servers: [remoteServer("gpu"), offline] });
  const before = structuredClone(api.workspaceStore.getSnapshot());
  await click(button(picker.container, "Select server staging"));
  assert.equal(button(picker.container, "Mount project space").disabled, true);
  assert.match(picker.container.textContent, /Connect this server to browse its folders/);
  assert.equal(
    picker.requests.some((request) => request.environmentId === "staging"),
    false,
  );
  await click(button(picker.container, "Connect now"));
  assert.deepEqual(picker.commands, [{ type: "connect", environmentId: "staging" }]);
  await picker.changeServers([remoteServer("gpu"), remoteServer("staging")]);
  assert.equal(picker.requests.at(-1).environmentId, "staging");
  assert.equal(picker.requests.at(-1).params.path, "~");
  assert.equal(button(picker.container, "Mount project space").disabled, false);
  assert.deepEqual(api.workspaceStore.getSnapshot(), before);
  assert.deepEqual(picker.writes, []);
  await click(button(picker.container, "+ Connect a new remote server ↗"));
  assert.equal(picker.settings(), 1);
  assert.equal(picker.closed(), 0);
});

test("loading and a mid-request disconnect never offer an old mount and stale completion stays hidden", async (t) => {
  const pending = deferred();
  const picker = await openPicker(t, { servers: [remoteServer("gpu")], reply: () => pending.promise });
  assert.match(picker.container.textContent, /Reading remote folders/);
  assert.equal(button(picker.container, "Mount project space").disabled, true);
  await picker.changeServers([remoteServer("gpu", { phase: "offline", lastFailure: null })]);
  await act(async () => pending.resolve(folderListing("/stale")));
  assert.match(picker.container.textContent, /Connect this server to browse its folders/);
  assert.equal(button(picker.container, "Mount project space").disabled, true);
  assert.doesNotMatch(picker.container.textContent, /\/stale/);
  assert.equal(api.workspaceStore.getSnapshot().focus.sessionId, "open-chat");
  assert.deepEqual(picker.writes, []);
});

test("the shared shell traps Tab at the edges and returns focus to the opener after closing", async (t) => {
  const prototype = dom.window.HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(prototype, "getClientRects");
  prototype.getClientRects = () => [{ width: 20, height: 20 }];
  const opener = dom.window.document.createElement("button");
  opener.textContent = "Open picker";
  dom.window.document.body.appendChild(opener);
  opener.focus();
  t.after(() => {
    if (original) Object.defineProperty(prototype, "getClientRects", original);
    else delete prototype.getClientRects;
    opener.remove();
  });
  const picker = await openPicker(t, { servers: [remoteServer("gpu")] });
  const dialog = picker.container.querySelector("[role='dialog']");
  const first = dialog.querySelector("button:not([disabled])");
  const last = button(dialog, "Mount project space");
  const tab = await keyDown(last, "Tab");
  assert.equal(tab.defaultPrevented, true);
  assert.equal(dom.window.document.activeElement, first);
  const shiftTab = await keyDown(first, "Tab", { shiftKey: true });
  assert.equal(shiftTab.defaultPrevented, true);
  assert.equal(dom.window.document.activeElement, last);
  await keyDown(dialog, "Escape");
  assert.equal(picker.closed(), 1);
  await picker.unmount();
  assert.equal(dom.window.document.activeElement, opener);
});

test("a truncated listing explains missing folders and keeps direct path navigation available", async (t) => {
  const picker = await openPicker(t, {
    servers: [remoteServer("gpu")],
    reply: (_id, _method, params) =>
      params.path === "~"
        ? folderListing("/home/dev", { truncated: true })
        : folderListing("/home/dev/hidden-project", { displayPath: "~/hidden-project" }),
  });
  assert.match(picker.container.textContent, /Some folders are not shown\. Enter a path to open them directly\./);
  const field = picker.container.querySelector("input[aria-label='Remote folder path']");
  await input(field, "~/hidden-project");
  await keyDown(field, "Enter");
  assert.equal(field.value, "~/hidden-project");
  assert.equal(button(picker.container, "Mount project space").disabled, false);
  assert.deepEqual(picker.requests.at(-1), {
    environmentId: "gpu",
    method: "projects.browse",
    params: { path: "~/hidden-project" },
  });
  assert.equal(api.workspaceStore.getSnapshot().focus.sessionId, "open-chat");
  assert.deepEqual(picker.writes, []);
});

test("a single click in the right folder column keeps both lists visible and only explicit open advances the root", async (t) => {
  const workspace = { name: "workspace", path: "/home/dev/workspace", displayPath: "~/workspace", git: null };
  const app = {
    name: "app",
    path: "/srv/app",
    displayPath: "~/workspace/app",
    git: { branch: "main", detached: false },
  };
  const sibling = {
    name: "inference",
    path: "/home/dev/workspace/inference",
    displayPath: "~/workspace/inference",
    git: { branch: "feat/fp8", detached: false },
  };
  const picker = await openPicker(t, {
    servers: [remoteServer("gpu")],
    reply: (_id, method, params) => {
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      if (params.path === "~") return folderListing("/home/dev", { folders: [workspace] });
      if (params.path === "~/workspace") return folderListing("/home/dev/workspace", { folders: [app, sibling] });
      return folderListing("/srv/app", { displayPath: "~/workspace/app", git: app.git });
    },
  });
  await click(button(picker.container, "Select folder workspace"));
  await click(button(picker.container, "Select folder app"));
  const lists = [...picker.container.querySelectorAll("[aria-label='Remote folder browser'] ul")];
  assert.deepEqual(
    lists.map((list) => list.getAttribute("aria-label")),
    ["~", "~/workspace"],
  );
  assert.ok(button(lists[0], "Select folder workspace"));
  assert.ok(button(lists[1], "Select folder inference"));
  const selected = button(lists[1], "Select folder app");
  assert.equal(selected.getAttribute("aria-pressed"), "true");
  assert.match(selected.textContent, /git · main/);
  assert.match(selected.textContent, /✓ Selected/);
  assert.equal(picker.container.querySelector("input[aria-label='Remote folder path']").value, "~/workspace/app");
  assert.equal(api.workspaceStore.getSnapshot().focus.sessionId, "open-chat");
  assert.deepEqual(picker.writes, []);
  await click(button(lists[1], "Open folder app"));
  assert.equal(
    picker.container.querySelector("[aria-label='Remote folder browser'] h3").textContent,
    "~/workspace/app",
  );
});

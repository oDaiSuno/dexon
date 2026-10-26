import assert from "node:assert/strict";
import test from "node:test";
import * as policy from "./menu-policy.ts";

const { developerViewRoles } = policy;

test("reload and DevTools roles are exposed only in development menus", () => {
  assert.deepEqual(developerViewRoles(false), []);
  assert.deepEqual(developerViewRoles(true), ["reload", "forceReload", "toggleDevTools"]);
});

test("the View menu offers the sidebar and processes shortcuts", () => {
  assert.deepEqual(policy.viewShortcutCommands, [
    { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+\\", event: "toggle-sidebar" },
    { label: "Show Processes", accelerator: "CmdOrCtrl+J", event: "open-processes" },
  ]);
});

test("the File menu offers the project switcher and add-project shortcuts", () => {
  assert.deepEqual(policy.fileShortcutCommands, [
    { label: "Switch Project…", accelerator: "CmdOrCtrl+P", event: "open-project-switcher" },
    { label: "Add Project from Folder…", accelerator: "CmdOrCtrl+O", event: "add-project" },
  ]);
});

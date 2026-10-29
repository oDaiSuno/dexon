import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  click,
  act,
  input,
  keyDown,
  hover,
  waitFor,
  visibleText,
  textBlocks,
  dom,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import {
  projectOrder,
  projectItem,
  projectMenu,
  enabledAction,
  unavailableAction,
} from "../support/app-navigation-projects.mjs";
import { navigationPaths } from "../fixtures/app-navigation-data.mjs";
import { accessibleName } from "../support/dom-queries.mjs";

after(restoreGlobals);

const DEFAULT = "Default space";
const PROJECT = "navigation-project";
const EMPTY = "empty-project";
const REMOVED = "removed-project";
const TERMINAL = "terminal-only-project";
const ADD_FROM_FOLDER = "Add project space from folder…";
const saved = (...folders) => ({ openProjects: folders });
const P = navigationPaths;

test("on first launch the project list holds only the default space, even though other folders have conversations", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT]));
  await scene.settled();
  assert.deepEqual(projectOrder(scene), [DEFAULT]);
});

test("a saved project list is shown in its saved order and a folder used only from the terminal does not appear", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.empty, P.project));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, EMPTY, PROJECT]));
  await scene.settled();
  assert.equal(projectOrder(scene).includes(TERMINAL), false);
});

test("a saved project without any conversation keeps its row and shows zero sessions", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.empty));
  const row = await waitFor(() => projectItem(scene, EMPTY));
  assert.match(row.textContent, /\b0\b/);
});

test("the default space is always the first row even when the saved list omits it", async (t) => {
  const scene = await startNavigation(t, saved(P.project));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT]));
});

test("a folder chosen with the system picker joins the list right below the default space and is still there after reopening", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.empty));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, EMPTY]));
  scene.external.desktop.selectedDirectory = P.project;
  await click(control(await scene.menu(DEFAULT), "menuitem", ADD_FROM_FOLDER));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT, EMPTY]));
  assert.equal(await scene.currentFolder(), P.project);
  const reopened = await scene.reload();
  await waitFor(() => assert.deepEqual(projectOrder(reopened), [DEFAULT, PROJECT, EMPTY]));
});

test("a folder path typed in the project switcher joins the list and becomes the current project", async (t) => {
  const scene = await startNavigation(t, { history: false });
  const card = await scene.menu(DEFAULT);
  const search = control(card, "searchbox", "Search or open a project…");
  await input(search, P.empty);
  await waitFor(() => control(card, "menuitem", `Open ${P.empty}`));
  await keyDown(search, "Enter");
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, EMPTY]));
  assert.equal(await scene.currentFolder(), P.empty);
});

test("opening a folder that is already in the list neither duplicates nor moves it", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.empty, P.project));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, EMPTY, PROJECT]));
  scene.external.desktop.selectedDirectory = P.project;
  await click(control(await scene.menu(DEFAULT), "menuitem", ADD_FROM_FOLDER));
  await waitFor(async () => assert.equal(await scene.currentFolder(), P.project));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, EMPTY, PROJECT]));
});

test("a session link to a conversation outside the list adds its project and moves there", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT]));
  await act(async () => scene.external.deepLink("terminal-only-history"));
  await waitFor(() => visibleText(scene.container, "Terminal only conversation marker"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, TERMINAL]));
  assert.equal(await scene.currentFolder(), P.terminalOnly);
});

test("an explicit startup session outside the list adds its project and opens there", async (t) => {
  const scene = await startNavigation(t, { initialSession: "terminal-only-history" });
  await waitFor(() => visibleText(scene.container, "Terminal only conversation marker"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, TERMINAL]));
});

test("a remembered space from before the list existed is added to the list", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project });
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT]));
  assert.equal(await scene.currentFolder(), P.project);
});

test("moving to another worktree of a listed project adds no row of its own", async (t) => {
  const scene = await startNavigation(t, { ...saved(P.personal, P.project), lastSpaceCwd: P.project });
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT]));
  await click(await waitFor(() => control(scene.history(), "button", "Review branch notes")));
  await waitFor(async () => assert.equal(await scene.currentFolder(), P.worktree));
  assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT]);
});

test("cancelling the system picker leaves the list unchanged", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.project));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT]));
  scene.external.desktop.selectedDirectory = null;
  await click(control(await scene.menu(DEFAULT), "menuitem", ADD_FROM_FOLDER));
  await waitFor(() => assert.equal(scene.external.desktop.directoryRequests, 1));
  await scene.settled();
  assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT]);
});

test("closing a project that is not current removes its row and keeps the current space", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.project, P.empty));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT, EMPTY]));
  await click(enabledAction(await projectMenu(scene, PROJECT), "Close project"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, EMPTY]));
  assert.equal(await scene.currentFolder(), P.personal);
  const reopened = await scene.reload();
  await waitFor(() => assert.deepEqual(projectOrder(reopened), [DEFAULT, EMPTY]));
});

test("closing the current project from its row returns to the default space, and it stays closed after reopening", async (t) => {
  const scene = await startNavigation(t, { ...saved(P.personal, P.project), lastSpaceCwd: P.project });
  await waitFor(() => control(scene.workspace(), "button", PROJECT));
  await click(enabledAction(await projectMenu(scene, PROJECT), "Close project"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT]));
  await waitFor(() => control(scene.workspace(), "button", DEFAULT));
  assert.equal(await scene.currentFolder(), P.personal);
  const reopened = await scene.reload();
  await waitFor(() => assert.deepEqual(projectOrder(reopened), [DEFAULT]));
  assert.equal(await reopened.currentFolder(), P.personal);
});

test("the project switcher card of the current project offers no way to close it", async (t) => {
  const scene = await startNavigation(t, { ...saved(P.personal, P.project), lastSpaceCwd: P.project });
  await waitFor(() => control(scene.workspace(), "button", PROJECT));
  const card = await scene.menu(PROJECT);
  assert.equal(
    roles(card, "menuitem", "Close project").length,
    0,
    "closing a project is done from its row, not the card",
  );
  await keyDown(card, "Escape");
  await scene.settled();
  assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT]);
});

test("a closed project brings its conversations back when its folder is opened again", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.project));
  await click(enabledAction(await projectMenu(scene, PROJECT), "Close project"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT]));
  scene.external.desktop.selectedDirectory = P.project;
  await click(control(await scene.menu(DEFAULT), "menuitem", ADD_FROM_FOLDER));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT]));
  await waitFor(() => control(scene.history(), "button", "Project release notes"));
});

test("the default space row offers no ⋯, whether or not it is the current project", async (t) => {
  const scene = await startNavigation(t, { ...saved(P.personal, P.project), lastSpaceCwd: P.project });
  await waitFor(() => control(scene.workspace(), "button", PROJECT));
  const row = projectItem(scene, DEFAULT);
  await hover(row);
  assert.equal(
    roles(row, "button", `Actions for ${DEFAULT}`).length,
    0,
    "the default space cannot be moved or closed, so its row has no ⋯",
  );
});

test("the project card of the current default space offers no Close project", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.project));
  unavailableAction(await scene.menu(DEFAULT), "Close project");
});

test("a project with a running conversation cannot be closed", async (t) => {
  const scene = await startNavigation(t, { ...saved(P.personal, P.project), runningSessionIds: ["project-history"] });
  await waitFor(() => projectItem(scene, PROJECT));
  const menu = await projectMenu(scene, PROJECT);
  unavailableAction(menu, "Close project");
  await keyDown(menu, "Escape");
  assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT]);
});

test("the project switcher search does not find a closed project", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.project));
  await click(enabledAction(await projectMenu(scene, PROJECT), "Close project"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT]));
  const card = await scene.menu(DEFAULT);
  await input(control(card, "searchbox", "Search or open a project…"), PROJECT);
  await scene.settled();
  assert.equal(roles(card, "menuitem", PROJECT).length, 0);
});

test("a listed folder that no longer exists keeps its place, says Folder not found and shows no session count", async (t) => {
  const scene = await startNavigation(t, {
    ...saved(P.personal, P.removed, P.project),
    unavailableSpaces: { [P.removed]: "gone" },
  });
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, REMOVED, PROJECT]));
  const row = await waitFor(() => {
    const item = projectItem(scene, REMOVED);
    assert.ok(textBlocks(item).includes("Folder not found"));
    return item;
  });
  assert.doesNotMatch(row.textContent, /\d/);
  const reopened = await scene.reload();
  await waitFor(() => assert.deepEqual(projectOrder(reopened), [DEFAULT, REMOVED, PROJECT]));
});

test("the menu of a missing folder explains that its sessions are kept and closing it is the only way to remove it", async (t) => {
  const scene = await startNavigation(t, {
    ...saved(P.personal, P.removed),
    unavailableSpaces: { [P.removed]: "gone" },
  });
  await waitFor(() => assert.ok(textBlocks(projectItem(scene, REMOVED)).includes("Folder not found")));
  const menu = await projectMenu(scene, REMOVED);
  visibleText(menu, "This folder was moved or deleted. Its sessions are kept.");
  await click(enabledAction(menu, "Close project"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT]));
});

test("a missing folder can be expanded to read its old conversations but opening one does not move there", async (t) => {
  const scene = await startNavigation(t, {
    ...saved(P.personal, P.removed),
    unavailableSpaces: { [P.removed]: "gone" },
  });
  await click(await waitFor(() => control(projectItem(scene, REMOVED), "button", REMOVED)));
  await click(await waitFor(() => control(scene.history(), "button", "Removed project notes")));
  await waitFor(() => visibleText(scene.container, "Removed project conversation marker"));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.personal);
  control(scene.workspace(), "button", DEFAULT);
});

test("a folder that comes back is no longer marked missing after reopening the application", async (t) => {
  const scene = await startNavigation(t, {
    ...saved(P.personal, P.removed),
    unavailableSpaces: { [P.removed]: "gone" },
  });
  await waitFor(() => assert.ok(textBlocks(projectItem(scene, REMOVED)).includes("Folder not found")));
  scene.external.restoreFolder(P.removed);
  const reopened = await scene.reload();
  await reopened.settled();
  assert.equal(textBlocks(projectItem(reopened, REMOVED)).includes("Folder not found"), false);
});

test("a folder that disappears is marked missing after the Switch Session command refreshes the list", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.empty));
  await waitFor(() => projectItem(scene, EMPTY));
  await scene.settled();
  scene.external.removeFolder(P.empty);
  await act(async () => scene.external.menu("switch-session"));
  await waitFor(() => assert.ok(textBlocks(projectItem(scene, EMPTY)).includes("Folder not found")));
});

test("Move down and Move up swap a project with its neighbour and the order survives reopening", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.project, P.empty));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT, EMPTY]));
  await click(enabledAction(await projectMenu(scene, PROJECT), "Move down"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, EMPTY, PROJECT]));
  await click(enabledAction(await projectMenu(scene, PROJECT), "Move up"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT, EMPTY]));
  await click(enabledAction(await projectMenu(scene, PROJECT), "Move down"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, EMPTY, PROJECT]));
  const reopened = await scene.reload();
  await waitFor(() => assert.deepEqual(projectOrder(reopened), [DEFAULT, EMPTY, PROJECT]));
});

test("the first movable project cannot move above the default space and the last project cannot move down", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.project, P.empty));
  const first = await projectMenu(scene, PROJECT);
  unavailableAction(first, "Move up");
  enabledAction(first, "Move down");
  await keyDown(first, "Escape");
  await waitFor(() => assert.equal(roles(dom.window.document.body, "menu", PROJECT).length, 0));
  const last = await projectMenu(scene, EMPTY);
  enabledAction(last, "Move up");
  unavailableAction(last, "Move down");
});

test("two moves made while the first save is still pending end in the right order after reopening", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.project, P.empty, P.terminalOnly));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT, EMPTY, TERMINAL]));
  await scene.settled();
  const firstSave = scene.external.hold("desktop.setUiState");
  await click(enabledAction(await projectMenu(scene, PROJECT), "Move down"));
  await waitFor(() => assert.ok(firstSave.reached()));
  await click(enabledAction(await projectMenu(scene, PROJECT), "Move down"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, EMPTY, TERMINAL, PROJECT]));
  firstSave.release();
  await scene.settled();
  const reopened = await scene.reload();
  await waitFor(() => assert.deepEqual(projectOrder(reopened), [DEFAULT, EMPTY, TERMINAL, PROJECT]));
});

test("in Chinese the list names the default space 默认空间 and its menus read 上移, 下移, 关闭项目 and 找不到文件夹", async (t) => {
  const scene = await startNavigation(t, {
    language: "zh-CN",
    ...saved(P.personal, P.project, P.removed),
    unavailableSpaces: { [P.removed]: "gone" },
  });
  await waitFor(() => assert.deepEqual(projectOrder(scene), ["默认空间", PROJECT, REMOVED]));
  await waitFor(() => assert.ok(textBlocks(projectItem(scene, REMOVED)).includes("找不到文件夹")));
  const menu = await projectMenu(scene, PROJECT);
  enabledAction(menu, "下移");
  unavailableAction(menu, "上移");
  enabledAction(menu, "关闭项目");
});

test("a project added by a session link is still listed after going back to the default space and reopening", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT]));
  await act(async () => scene.external.deepLink("terminal-only-history"));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, TERMINAL]));
  await click(control(await scene.menu(TERMINAL), "menuitem", "Back to default space"));
  await waitFor(async () => assert.equal(await scene.currentFolder(), P.personal));
  assert.deepEqual(projectOrder(scene), [DEFAULT, TERMINAL]);
  const reopened = await scene.reload();
  await waitFor(() => assert.deepEqual(projectOrder(reopened), [DEFAULT, TERMINAL]));
});

async function sendFirstMessage(scene) {
  await click(control(scene.navigation(), "button", scene.labels.newSession));
  const chat = control(scene.container, "region", "Chat");
  const composer = await waitFor(() => control(chat, "textbox"));
  await act(async () => {
    composer.focus();
    composer.textContent = "Draft the worktree note";
    const range = dom.window.document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    composer.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
  await click(control(chat, "button", "Send"));
  await waitFor(() => assert.equal(scene.external.prompts().length, 1, "the first message reached the Host"));
}

test("a conversation started in a worktree of a listed project adds no row for that checkout", async (t) => {
  const scene = await startNavigation(t, { ...saved(P.personal, P.project), lastSpaceCwd: P.project });
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT]));
  await click(await waitFor(() => control(scene.history(), "button", "Review branch notes")));
  await waitFor(async () => assert.equal(await scene.currentFolder(), P.worktree));
  await sendFirstMessage(scene);
  await scene.settled();
  assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT]);
  const reopened = await scene.reload();
  await waitFor(() => assert.deepEqual(projectOrder(reopened), [DEFAULT, PROJECT]));
});

test("the arrow keys move through the usable actions of another project's menu and the focused action still works", async (t) => {
  const scene = await startNavigation(t, saved(P.personal, P.project, P.empty));
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, PROJECT, EMPTY]));
  const menu = await projectMenu(scene, PROJECT);
  const focused = () => dom.window.document.activeElement;
  await keyDown(menu, "ArrowDown");
  enabledAction(menu, "Move down");
  assert.equal(accessibleName(focused()), "Move down");
  await keyDown(focused(), "ArrowDown");
  assert.equal(accessibleName(focused()), "Close project");
  await keyDown(focused(), "ArrowUp");
  assert.equal(accessibleName(focused()), "Move down");
  await click(focused());
  await waitFor(() => assert.deepEqual(projectOrder(scene), [DEFAULT, EMPTY, PROJECT]));
});

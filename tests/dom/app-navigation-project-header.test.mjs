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
  mouseDown,
  waitFor,
  visibleText,
  dom,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { projectOrder, projectItem, projectMenu, unavailableAction } from "../support/app-navigation-projects.mjs";
import {
  installBrowserEvents,
  openCard as openWorkspaceCard,
  projectsPane,
  triggerName,
} from "../support/app-navigation-workspace.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";
import { accessibleName, precedes } from "../support/dom-queries.mjs";

after(restoreGlobals);
after(installBrowserEvents());

const DEFAULT = "Default space";
const PROJECT = "navigation-project";
const EMPTY = "empty-project";
const SWITCHER = "Switch or add project";
const COLLAPSE_ALL = "Collapse all projects";
const EXPAND_CURRENT = "Expand current project";
const ADD_FROM_FOLDER = "Add project space from folder…";
const BACK_TO_DEFAULT = "Back to default space";
const SEARCH_CARD = "Search or open a project…";
const PROJECT_SESSION = "Project release notes";
const PROJECT_CONVERSATION = "Project conversation marker";

const saved = { openProjects: [P.personal, P.project, P.empty], lastSpaceCwd: P.project };

const cards = () => roles(dom.window.document.body, "menu");
const cardActions = (card) => roles(card, "menuitem").map(accessibleName);

function expandedRows(scene) {
  return Object.fromEntries(
    projectOrder(scene).map((name) => [
      name,
      control(projectItem(scene, name), "button", name).getAttribute("aria-expanded"),
    ]),
  );
}

async function ready(t, options = saved) {
  const scene = await startNavigation(t, options);
  await waitFor(() => assert.equal(projectOrder(scene).length, 3));
  return scene;
}

async function openCard(scene) {
  await click(control(scene.history(), "button", SWITCHER));
  return waitFor(() => {
    const open = cards();
    assert.equal(open.length, 1, "exactly one switcher card is open");
    return open[0];
  });
}

async function switchTo(scene, name, folder) {
  const card = await openCard(scene);
  const search = control(card, "searchbox", SEARCH_CARD);
  await input(search, name);
  await waitFor(() => assert.equal(accessibleName(roles(card, "menuitem")[0]), name));
  await keyDown(search, "Enter");
  await waitFor(async () => assert.equal(await scene.currentFolder(), folder));
}

async function expectProjectConversationStillOpen(scene, order) {
  await waitFor(() => visibleText(scene.container, PROJECT_CONVERSATION));
  assert.equal(
    dom.window.location.search,
    "?session=project-history",
    "the conversation open beside the sidebar is the same one",
  );
  assert.deepEqual(projectOrder(scene), order, "the list and its order are unchanged");
  assert.equal(await scene.currentFolder(), P.project, "the current project is unchanged");
}

function placeButton(t, element, box) {
  t.mock.method(dom.window.HTMLElement.prototype, "getBoundingClientRect", function getBoundingClientRect() {
    return this === element ? box : { x: 0, y: 0, left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  });
}

test("every project row but the default space offers the same actions menu, and the current project is no different", async (t) => {
  const scene = await ready(t);
  assert.equal(
    roles(projectItem(scene, DEFAULT), "button", `Actions for ${DEFAULT}`).length,
    0,
    "the default space row has no actions menu: it can be neither moved nor closed",
  );
  for (const name of [PROJECT, EMPTY]) {
    const menu = await projectMenu(scene, name);
    assert.deepEqual(
      cardActions(menu),
      ["Move up", "Move down", "Close project"],
      `${name} offers the same three actions, whether or not it is the current project`,
    );
    assert.equal(roles(menu, "menuitem", BACK_TO_DEFAULT).length, 0, "the row menu offers no way back");
    await keyDown(menu, "Escape");
    await waitFor(() => assert.equal(cards().length, 0));
  }
});

test("a project with a running conversation keeps Close project in its row menu, greyed out instead of missing", async (t) => {
  const scene = await ready(t, { ...saved, runningSessionIds: ["project-history"] });
  const menu = await projectMenu(scene, PROJECT);
  assert.deepEqual(cardActions(menu), ["Move up", "Move down", "Close project"]);
  unavailableAction(menu, "Close project");
});

test("the project spaces header puts one button for folding beside Switch or add project, both 22 by 22", async (t) => {
  const scene = await ready(t);
  const header = scene.history();
  const folding = control(header, "button", COLLAPSE_ALL);
  const plus = control(header, "button", SWITCHER);
  assert.ok(precedes(folding, plus), "the folding button is the left one of the two");
  for (const button of [folding, plus]) {
    const style = dom.window.getComputedStyle(button);
    assert.equal(style.width, "22px");
    assert.equal(style.height, "22px");
  }
});

test("the + opens a single card that grows out of its top-right corner, four pixels below it", async (t) => {
  const scene = await ready(t);
  const plus = control(scene.history(), "button", SWITCHER);
  assert.equal(cards().length, 0, "the card starts closed");
  const box = { x: 878, y: 138, left: 878, right: 900, top: 138, bottom: 160, width: 22, height: 22 };
  placeButton(t, plus, box);
  await click(plus);
  const card = await waitFor(() => {
    const open = cards();
    assert.equal(open.length, 1, "one card appears, not a stack of row menus");
    return open[0];
  });
  assert.equal(plus.getAttribute("aria-expanded"), "true", "the + is shown as open while the card is up");
  assert.equal(accessibleName(card), PROJECT, "the card belongs to the current project");
  const left = Number.parseFloat(card.style.left);
  const width = Number.parseFloat(card.style.width);
  assert.equal(Number.parseFloat(card.style.top), box.bottom + 4, "the card starts four pixels below the +");
  assert.equal(left + width, box.right, "the right edge of the card lines up with the right edge of the +");
  assert.equal(card.style.transformOrigin, "top right", "the card grows out of its top-right corner");
});

test("the card closes again from the +, from Escape and from a press outside it", async (t) => {
  const scene = await ready(t);
  const plus = control(scene.history(), "button", SWITCHER);
  await click(plus);
  await waitFor(() => assert.equal(cards().length, 1));
  await click(plus);
  await waitFor(() => assert.equal(cards().length, 0));
  assert.equal(plus.getAttribute("aria-expanded"), "false", "the + no longer looks open");

  await click(plus);
  await keyDown(await waitFor(() => cards()[0]), "Escape");
  await waitFor(() => assert.equal(cards().length, 0));

  await click(plus);
  await mouseDown(await waitFor(() => cards()[0]));
  assert.equal(cards().length, 1, "a press inside the card leaves it open");
  await mouseDown(dom.window.document.body);
  await waitFor(() => assert.equal(cards().length, 0));
});

test("the card holds the search box, the current project and the two space actions in that order, without Close project", async (t) => {
  const scene = await ready(t);
  const card = await openCard(scene);
  const search = control(card, "searchbox", SEARCH_CARD);
  const group = visibleText(card, "Current project");
  const name = visibleText(card, PROJECT);
  const folder = visibleText(card, "/work");
  assert.deepEqual(cardActions(card), [ADD_FROM_FOLDER, BACK_TO_DEFAULT], "the two space actions, in order");
  assert.ok(precedes(search, group), "the search box comes first");
  assert.ok(precedes(group, name), "the current project is named under its own heading");
  assert.ok(precedes(name, folder), "the folder the project lives in follows its name");
  assert.ok(precedes(folder, control(card, "menuitem", ADD_FROM_FOLDER)), "the actions come last");
  assert.equal(roles(card, "menuitem", "Close project").length, 0, "closing a project stays in the row menu");
});

test("the desktop Switch Project command opens one card with the cursor already in its search box", async (t) => {
  const scene = await ready(t);
  await scene.settled();
  await act(async () => scene.external.menu("open-project-switcher"));
  const card = await waitFor(() => {
    const open = cards();
    assert.equal(open.length, 1, "⌘P opens one card and leaves every row menu closed");
    return open[0];
  });
  assert.equal(accessibleName(card), PROJECT, "the card is the current project's");
  assert.ok(
    dom.window.document.activeElement === control(card, "searchbox", SEARCH_CARD),
    "typing goes straight into the search box",
  );
});

test("the desktop Switch Project command brings a collapsed sidebar back and then opens that same card", async (t) => {
  const scene = await ready(t);
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  await act(async () => scene.external.menu("open-project-switcher"));
  await waitFor(() => control(scene.navigation(), "button", "Hide sidebar"));
  const card = await waitFor(() => {
    const open = cards();
    assert.equal(open.length, 1, "one card, opened after the sidebar came back");
    return open[0];
  });
  assert.equal(accessibleName(card), PROJECT);
  assert.ok(
    dom.window.document.activeElement === control(card, "searchbox", SEARCH_CARD),
    "the cursor is in the search box",
  );
});

test("switching projects from the card still works while the session search hides the current project's row", async (t) => {
  const scene = await ready(t);
  await input(control(scene.navigation(), "searchbox", "Search sessions"), "Personal release");
  await scene.settled();
  assert.equal(roles(scene.history(), "button", PROJECT).length, 0, "the current project row is filtered away");
  await act(async () => scene.external.menu("open-project-switcher"));
  const card = await waitFor(() => {
    const open = cards();
    assert.equal(open.length, 1);
    return open[0];
  });
  assert.equal(accessibleName(card), PROJECT, "the card still belongs to the current project");
  const search = control(card, "searchbox", SEARCH_CARD);
  await input(search, EMPTY);
  await waitFor(() => assert.equal(accessibleName(roles(card, "menuitem")[0]), EMPTY));
  await keyDown(search, "Enter");
  await waitFor(async () => assert.equal(await scene.currentFolder(), P.empty));
});

test("a project chosen in the composer card is switched to directly, without bringing the sidebar's project card back", async (t) => {
  const scene = await ready(t);
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  await openWorkspaceCard(scene);
  await click(control(projectsPane(scene), "button", EMPTY));
  await waitFor(() => assert.equal(triggerName(scene), `Workspace: ${EMPTY}`));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.empty);
  assert.equal(cards().length, 0, "no separate project switcher card was opened");
  control(scene.navigation(), "button", "Show sidebar");
});

test("Collapse all projects folds every open row, the ones opened by hand included, and the button then offers Expand current project", async (t) => {
  const scene = await ready(t);
  assert.deepEqual(
    expandedRows(scene),
    { [DEFAULT]: "false", [PROJECT]: "true", [EMPTY]: "false" },
    "the current project is open before anyone touches a row",
  );
  await click(control(projectItem(scene, DEFAULT), "button", DEFAULT));
  await waitFor(() => assert.equal(expandedRows(scene)[DEFAULT], "true"), "the default space is opened by hand");
  await click(control(projectItem(scene, EMPTY), "button", EMPTY));
  await waitFor(() => assert.equal(expandedRows(scene)[EMPTY], "true"), "a second project is opened by hand");
  control(scene.history(), "button", COLLAPSE_ALL);
  await click(control(scene.history(), "button", COLLAPSE_ALL));
  await waitFor(() =>
    assert.deepEqual(
      expandedRows(scene),
      { [DEFAULT]: "false", [PROJECT]: "false", [EMPTY]: "false" },
      "every row folds: the current one and the ones opened by hand",
    ),
  );
  control(scene.history(), "button", EXPAND_CURRENT);
});

test("Expand current project opens only the current row, and the button keeps following the rows folded by hand", async (t) => {
  const scene = await ready(t);
  await click(control(scene.history(), "button", COLLAPSE_ALL));
  await click(await waitFor(() => control(scene.history(), "button", EXPAND_CURRENT)));
  await waitFor(() =>
    assert.deepEqual(expandedRows(scene), { [DEFAULT]: "false", [PROJECT]: "true", [EMPTY]: "false" }),
  );
  control(scene.history(), "button", COLLAPSE_ALL);
  await click(control(scene.history(), "button", COLLAPSE_ALL));
  await waitFor(() => control(scene.history(), "button", EXPAND_CURRENT));
  await click(control(projectItem(scene, EMPTY), "button", EMPTY));
  await waitFor(() => assert.equal(expandedRows(scene)[EMPTY], "true"));
  control(scene.history(), "button", COLLAPSE_ALL);
  await click(control(projectItem(scene, EMPTY), "button", EMPTY));
  await waitFor(() => assert.equal(expandedRows(scene)[EMPTY], "false"), "the last open row is folded by hand");
  control(scene.history(), "button", EXPAND_CURRENT);
});

test("while the session search has text the folding button is greyed out, and it comes back once the search is cleared", async (t) => {
  const scene = await ready(t);
  const box = control(scene.navigation(), "searchbox", "Search sessions");
  await input(box, "release");
  await scene.settled();
  assert.equal(
    control(scene.history(), "button", COLLAPSE_ALL).disabled,
    true,
    "the button cannot be used while searching",
  );
  await input(box, "");
  await scene.settled();
  assert.equal(control(scene.history(), "button", COLLAPSE_ALL).disabled, false, "the button is usable again");
  assert.deepEqual(expandedRows(scene), { [DEFAULT]: "false", [PROJECT]: "true", [EMPTY]: "false" });
});

test("folding rows changes nothing else: the list, its order, the current project and the conversation open beside it all stay", async (t) => {
  const scene = await ready(t);
  const order = projectOrder(scene);
  await click(control(scene.history(), "button", PROJECT_SESSION));
  await expectProjectConversationStillOpen(scene, order);
  await click(control(scene.history(), "button", COLLAPSE_ALL));
  await waitFor(() =>
    assert.deepEqual(expandedRows(scene), { [DEFAULT]: "false", [PROJECT]: "false", [EMPTY]: "false" }),
  );
  await expectProjectConversationStillOpen(scene, order);
  await click(await waitFor(() => control(scene.history(), "button", EXPAND_CURRENT)));
  await waitFor(() => assert.equal(expandedRows(scene)[PROJECT], "true"));
  await expectProjectConversationStillOpen(scene, order);
  await waitFor(() => control(scene.history(), "button", PROJECT_SESSION));
});

test("a project the folding button folded away opens itself when the card switches to it, and the rows around it stay shut", async (t) => {
  const scene = await ready(t);
  await click(control(projectItem(scene, EMPTY), "button", EMPTY));
  await waitFor(() => assert.equal(expandedRows(scene)[EMPTY], "true"), "the row is opened by hand first");
  await click(control(scene.history(), "button", COLLAPSE_ALL));
  await waitFor(() =>
    assert.deepEqual(
      expandedRows(scene),
      { [DEFAULT]: "false", [PROJECT]: "false", [EMPTY]: "false" },
      "Collapse all projects folds the row opened by hand as well",
    ),
  );
  await switchTo(scene, EMPTY, P.empty);
  await waitFor(() =>
    assert.deepEqual(
      expandedRows(scene),
      { [DEFAULT]: "false", [PROJECT]: "false", [EMPTY]: "true" },
      "the project switched to opens again; the one just left and the rest keep the state they had",
    ),
  );
  await waitFor(() => control(scene.history(), "button", COLLAPSE_ALL));
});

test("a row opened by hand stays open when another project is entered from the card", async (t) => {
  const scene = await ready(t);
  await click(control(projectItem(scene, DEFAULT), "button", DEFAULT));
  await waitFor(() => assert.equal(expandedRows(scene)[DEFAULT], "true"), "the default space is opened by hand");
  await switchTo(scene, EMPTY, P.empty);
  await waitFor(() =>
    assert.deepEqual(
      expandedRows(scene),
      { [DEFAULT]: "true", [PROJECT]: "false", [EMPTY]: "true" },
      "the project just entered opens, the row opened by hand keeps its own state, and the project left behind follows the old rule",
    ),
  );
});

test("a project left behind that was never folded by hand folds back like any other row that is not current", async (t) => {
  const scene = await ready(t);
  await switchTo(scene, EMPTY, P.empty);
  await waitFor(() =>
    assert.deepEqual(
      expandedRows(scene),
      { [DEFAULT]: "false", [PROJECT]: "false", [EMPTY]: "true" },
      "leaving a project folds it back: only the current project is open by default",
    ),
  );
  await switchTo(scene, PROJECT, P.project);
  await waitFor(() =>
    assert.deepEqual(expandedRows(scene), { [DEFAULT]: "false", [PROJECT]: "true", [EMPTY]: "false" }),
  );
});

test("in Chinese the header reads 切换或新增项目, then 收起全部项目 and 展开当前项目 as the rows fold and unfold", async (t) => {
  const scene = await ready(t, { ...saved, language: "zh-CN" });
  await click(control(scene.history(), "button", "切换或新增项目"));
  await waitFor(() => {
    const open = cards();
    assert.equal(open.length, 1);
    return open[0];
  });
  const card = cards()[0];
  assert.deepEqual(cardActions(card), ["从文件夹新增项目空间…", "返回默认空间"]);
  await keyDown(card, "Escape");
  await waitFor(() => assert.equal(cards().length, 0));
  await click(control(scene.history(), "button", "收起全部项目"));
  await waitFor(() => control(scene.history(), "button", "展开当前项目"));
});

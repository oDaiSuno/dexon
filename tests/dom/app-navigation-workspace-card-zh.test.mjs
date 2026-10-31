import assert from "node:assert/strict";
import test, { after } from "node:test";
import { click, control, dom, roles, startNavigation, waitFor, restoreGlobals } from "../support/app-navigation.mjs";
import {
  branchesPane,
  branchRow,
  browseDown,
  card,
  expectedTrigger,
  installBrowserEvents,
  isDisabled,
  mentions,
  openCard,
  says,
  saysNot,
  triggerName,
} from "../support/app-navigation-workspace.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);
after(installBrowserEvents());

function useClipboard(t, writeText) {
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", { configurable: true, value: { writeText } });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
}

test("in Chinese the branch list keeps the same sections, the main folder label and the stale registration note", async (t) => {
  const scene = await startNavigation(t, {
    language: "zh-CN",
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project],
  });
  const menu = await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  says(menu, "当前", "在各自文件夹中", "其他本地分支", "按最近提交");
  assert.ok(branchRow(pane, "main").textContent.includes("主文件夹"));
  assert.equal(isDisabled(branchRow(pane, "chore/gamma")), true);
  assert.ok(branchRow(pane, "chore/gamma").textContent.includes("仍登记在已不存在的文件夹"));
  assert.ok(branchRow(pane, "chore/gamma").textContent.includes(P.staleCheckout));
  assert.ok(branchRow(pane, "review").textContent.includes(P.worktree));
  assert.ok(branchRow(pane, "a3f9c21").textContent.includes("未在任何分支上"));
  assert.equal(control(pane, "textbox", "筛选分支…").getAttribute("aria-label"), "筛选分支…");
});

test("in Chinese a dirty folder stops the switch with the Chinese reason, detail and buttons", async (t) => {
  const scene = await startNavigation(t, {
    language: "zh-CN",
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project],
    dirtyFolders: [P.project],
  });
  await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  await click(branchRow(pane, "feat/alpha"));
  await waitFor(() => assert.ok(mentions(card(scene), "当前文件夹有未提交的改动")));
  const menu = card(scene);
  says(menu, "现在切分支，这些改动会被带到另一个分支。");
  await click(control(menu, "button", "在新 worktree 中打开"));
  await waitFor(() => assert.equal(card(scene), undefined));
  await waitFor(() => assert.equal(triggerName(scene), expectedTrigger(scene, "navigation-project", "feat/alpha")));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.alphaWorktree);
});

test("in Chinese a project that is not a Git repository says so and can be switched to", async (t) => {
  const scene = await startNavigation(t, {
    language: "zh-CN",
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project, P.terminalOnly],
  });
  await openCard(scene);
  await browseDown(scene, () => mentions(card(scene), "terminal-only-project 不是 git 仓库"));
  const menu = card(scene);
  says(menu, "这里没有分支可选。按回车或点左侧这一行，直接切换到这个文件夹。");
  await click(control(menu, "button", "切换到 terminal-only-project"));
  await waitFor(() => assert.equal(card(scene), undefined));
  await waitFor(() => assert.equal(triggerName(scene), expectedTrigger(scene, "terminal-only-project")));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.terminalOnly);
});

test("in Chinese an open conversation's card shows the read-only note and copies its own folder", async (t) => {
  const written = [];
  useClipboard(t, async (value) => {
    written.push(value);
  });
  const scene = await startNavigation(t, { language: "zh-CN", initialSession: "review-history" });
  await waitFor(() => assert.equal(triggerName(scene), expectedTrigger(scene, "navigation-project", "review")));
  const menu = await openCard(scene);
  says(menu, "会话创建时就定在这里。想换位置，请新建会话。", P.worktree);
  saysNot(menu, "新建 worktree");
  assert.equal(roles(menu, "button", "查看 navigation-project 的分支").length, 0);
  await click(control(menu, "button", "复制路径"));
  await waitFor(() => assert.deepEqual(written, [P.worktree]));
});

test("in Chinese every open project is listed with its own sub line", async (t) => {
  const scene = await startNavigation(t, {
    language: "zh-CN",
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project, P.terminalOnly],
  });
  await openCard(scene);
  assert.ok(control(card(scene), "button", "默认空间").textContent.includes("不属于任何仓库"));
  assert.ok(control(card(scene), "button", "terminal-only-project").textContent.includes("不是 git 仓库"));
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  assert.ok(branchRow(pane, "main").textContent.includes("主文件夹"));
});

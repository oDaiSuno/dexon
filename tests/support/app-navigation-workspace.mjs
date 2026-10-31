import assert from "node:assert/strict";
import { accessibleName } from "./dom-queries.mjs";
import { act, click, control, dom, hover, keyDown, roles, waitFor } from "./app-navigation.mjs";
// The composer's workspace card, addressed the way a user meets it: the
// labelled chat area, the labelled card, the two labelled panes, and one
// button per project or branch.
export const chatArea = (scene) => control(scene.container, "region", scene.labels.chat);

export const card = (scene) => roles(chatArea(scene), "group", scene.labels.workspace)[0];

export function trigger(scene) {
  const matches = roles(chatArea(scene), "button").filter((element) =>
    accessibleName(element).startsWith(scene.labels.triggerPrefix),
  );
  assert.equal(matches.length, 1, `Expected one footer location trigger; found ${matches.length}`);
  return matches[0];
}

export function triggerName(scene) {
  return accessibleName(trigger(scene));
}

export async function openCard(scene) {
  if (!card(scene)) await click(trigger(scene));
  return waitFor(() => {
    const open = card(scene);
    assert.ok(open, "the workspace card is open");
    return open;
  });
}

export async function closeCard(scene) {
  if (!card(scene)) return;
  await click(trigger(scene));
  await waitFor(() => assert.equal(card(scene), undefined, "the workspace card is closed"));
}

export function named(label, name) {
  return label.replace("{project}", name);
}

export function expectedTrigger(scene, project, branch) {
  const template = branch ? scene.labels.triggerLabelWithBranch : scene.labels.triggerLabel;
  return template.replace("{project}", project).replace("{branch}", branch ?? "");
}

export function projectsPane(scene) {
  return control(card(scene), "group", scene.labels.projects);
}

export function projectRow(scene, name) {
  return control(projectsPane(scene), "button", name);
}

export function projectRowNames(scene) {
  return roles(projectsPane(scene), "button")
    .filter((element) => !accessibleName(element).startsWith(scene.labels.showBranchesPrefix))
    .map(accessibleName);
}

export function showBranchesButton(scene, name) {
  return control(projectsPane(scene), "button", named(scene.labels.showBranches, name));
}

export async function showBranches(scene, name) {
  await hover(projectRow(scene, name));
  await click(showBranchesButton(scene, name));
}

export function removeWorktreeButton(scene, folder) {
  const hint = `Remove worktree checkout ${folder}; the branch is kept`;
  const matches = roles(card(scene), "button").filter(
    (element) => element.title === hint || accessibleName(element) === hint,
  );
  assert.equal(matches.length, 1, `Expected one remove control for ${folder}; found ${matches.length}`);
  return matches[0];
}

export function branchesPane(scene, name) {
  return control(card(scene), "group", named(scene.labels.branchesOf, name));
}

export function branchRow(pane, name) {
  return control(pane, "button", name);
}

export function branchRowNames(pane, labels) {
  return roles(pane, "button")
    .map((element) => accessibleName(element))
    .filter((name) => name !== labels.newWorktree && !name.startsWith(labels.removeWorktreePrefix));
}

export function isCurrent(element) {
  const marked = element.getAttribute("aria-current");
  return marked !== null && marked !== "false";
}

export function isDisabled(element) {
  return element.disabled === true || element.getAttribute("aria-disabled") === "true";
}

export function mentions(root, ...phrases) {
  const text = root.textContent.replace(/\s+/g, " ");
  return phrases.every((phrase) => text.includes(phrase));
}

export function says(root, ...phrases) {
  for (const phrase of phrases)
    assert.ok(mentions(root, phrase), `Expected the card to say “${phrase}”; it says “${root.textContent}”`);
}

export function saysNot(root, phrase) {
  assert.ok(!root.textContent.includes(phrase), `The card should not say “${phrase}”`);
}

export function pressInCard(scene, key) {
  const open = card(scene);
  assert.ok(open, "the workspace card is open");
  const active = dom.window.document.activeElement;
  assert.ok(active === open || open.contains(active), "keyboard focus is inside the workspace card");
  return keyDown(active, key);
}

async function stepUntil(scene, predicate, key, presses) {
  for (let step = 0; step < presses && !predicate(); step += 1) await pressInCard(scene, key);
  assert.ok(predicate(), `arrowing through the project pane with ${key} reaches the expected project`);
}

export const browseDown = (scene, predicate) => stepUntil(scene, predicate, "ArrowDown", 4);
export const browseUp = (scene, predicate) => stepUntil(scene, predicate, "ArrowUp", 4);

const BROWSER_EVENTS = [
  "KeyboardEvent",
  "MouseEvent",
  "WheelEvent",
  "InputEvent",
  "FocusEvent",
  "ClipboardEvent",
  "DragEvent",
  "PointerEvent",
];

// The App's real listeners build browser events by name. Install the same
// constructors the page uses so a missing global cannot be mistaken for a
// missing behavior, and put the previous values back afterwards.
export function installBrowserEvents() {
  const originals = new Map();
  for (const name of BROWSER_EVENTS) {
    if (typeof dom.window[name] !== "function") continue;
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
  }
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    originals.clear();
  };
}

export function currentSidebarProject(scene) {
  const marked = roles(scene.history(), "button").filter(
    (element) => element.getAttribute("aria-current") === "location",
  );
  assert.equal(marked.length, 1, `Expected one current project row in the sidebar; found ${marked.length}`);
  return accessibleName(marked[0]);
}

export async function type(scene, value) {
  const composer = await waitFor(() => control(chatArea(scene), "textbox"));
  await act(async () => {
    composer.focus();
    composer.textContent = value;
    const range = dom.window.document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    composer.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
  await waitFor(() =>
    assert.equal(control(chatArea(scene), "textbox").textContent, value, "composer shows the typed text"),
  );
  return composer;
}

export async function draft(scene) {
  return (await waitFor(() => control(chatArea(scene), "textbox"))).textContent;
}

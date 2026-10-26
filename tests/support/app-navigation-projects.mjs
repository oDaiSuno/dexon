import assert from "node:assert/strict";
import { control, roles, click, hover, waitFor, dom } from "./app-navigation.mjs";
import { accessibleName } from "./dom-queries.mjs";

export function projectList(scene) {
  return control(scene.history(), "list", scene.labels.history);
}

export function projectItems(scene) {
  const list = projectList(scene);
  return roles(list, "listitem").filter((item) => item.parentElement?.closest('[role="list"]') === list);
}

export function projectOrder(scene) {
  return projectItems(scene).map(accessibleName);
}

export function projectItem(scene, name) {
  const matches = projectItems(scene).filter((item) => accessibleName(item) === name);
  assert.equal(matches.length, 1, `Expected one project named ${name}; found ${matches.length}`);
  return matches[0];
}

export async function projectMenu(scene, name) {
  const item = projectItem(scene, name);
  await hover(item);
  await click(control(item, "button", scene.labels.spaceActions.replace("{name}", name)));
  return waitFor(() => control(dom.window.document.body, "menu", name));
}

const disabled = (element) => element.disabled === true || element.getAttribute("aria-disabled") === "true";

export function enabledAction(menu, name) {
  const element = control(menu, "menuitem", name);
  assert.equal(disabled(element), false, `${name} can be used`);
  return element;
}

export function unavailableAction(menu, name) {
  const matches = roles(menu, "menuitem", name);
  assert.ok(matches.every(disabled), `${name} is absent or cannot be used`);
}

export function absentAction(menu, name) {
  assert.equal(roles(menu, "menuitem", name).length, 0, `${name} is not offered`);
}

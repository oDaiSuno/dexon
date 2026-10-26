import { control, click } from "./app-navigation.mjs";

export const chatRegion = (scene) => control(scene.container, "region", "Chat");

export const ADD_FROM_FOLDER = "Add project space from folder…";

// A space change made from the project card: the user picks the folder in the
// desktop's folder dialog.
export const openSwitchSpace = (scene, from) => async () =>
  click(control(await scene.menu(from), "menuitem", ADD_FROM_FOLDER));

export async function switchSpace(scene, path, from) {
  scene.external.desktop.selectedDirectory = path;
  await openSwitchSpace(scene, from)();
}

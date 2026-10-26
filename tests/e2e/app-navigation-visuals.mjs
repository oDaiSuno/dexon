import { nativeHistoryTitle } from "../fixtures/app-navigation-native.mjs";

export const finalVisualScreens = ["chat-expanded", "chat-rail", "plugins", "skills"];

export async function captureFinalVisuals({ window, js, click, exists, waitFor, screenshot }) {
  window.setContentSize(1280, 760);
  await waitFor(async () => (await js("document.documentElement.clientWidth")) === 1280, "the 1280px window");
  const settle = () =>
    js(
      "Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))).then(() => undefined)",
    );
  const isDark = () => js('document.documentElement.classList.contains("dark")');
  const escape = () => {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  };
  const useTheme = async (theme) => {
    if ((await isDark()) === (theme === "dark")) return;
    await click("button", "Settings");
    await waitFor(() => exists("region", "Settings"), "Settings opened for the theme switch");
    await js(`(() => {
      const select = [...document.querySelectorAll("select")].find((element) =>
        (document.querySelector('label[for="' + element.id + '"]')?.textContent ?? "").trim().startsWith("Theme"),
      );
      if (!select) throw new Error("Settings shows no Theme control");
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ${JSON.stringify(theme)});
      select.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(async () => (await isDark()) === (theme === "dark"), `the ${theme} theme`);
    escape();
    await waitFor(async () => !(await exists("region", "Settings")), "Settings closed after the theme switch");
    await settle();
  };
  const screens = {
    "chat-expanded": async () => {
      await click("button", nativeHistoryTitle);
      await waitFor(() => exists("group", "Message input"), "the chat page");
    },
    "chat-rail": async () => {
      await click("button", "Hide sidebar");
      await waitFor(() => exists("button", "Show sidebar"), "the collapsed rail");
    },
    plugins: async () => {
      await click("button", "Show sidebar");
      await waitFor(() => exists("button", "Personal space"), "the expanded navigation");
      await click("button", "Plugins & Skills");
      await waitFor(() => exists("heading", "Plugins & Skills"), "the resources overview");
      await settle();
      await click("button", "Manage sources");
      await click("tab", "Plugins");
      await waitFor(
        async () => (await js("document.body.innerText")).includes("production-navigation-plugin"),
        "the plugin list",
      );
    },
    skills: async () => {
      await click("tab", "Skills");
      await waitFor(
        async () => (await js("document.body.innerText")).includes("production-checklist"),
        "the skill list",
      );
      await click(undefined, undefined, "production-checklist");
      await waitFor(() => exists("button", "Open in editor"), "the skill preview");
    },
  };
  const files = [];
  for (const [index, theme] of ["light", "dark"].entries()) {
    await useTheme(theme);
    for (const [order, screen] of finalVisualScreens.entries()) {
      await screens[screen]();
      await settle();
      const number = String(order * 2 + index + 1).padStart(2, "0");
      files.push(await screenshot(`final-${number}-${screen}-${theme}`));
    }
  }
  return files.sort();
}

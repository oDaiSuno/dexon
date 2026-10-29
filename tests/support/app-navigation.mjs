import assert from "node:assert/strict";
import { dom, act, loadRenderer, mount, click, waitFor as waitForPage, restoreGlobals } from "./renderer.mjs";
import { accessibleName, allByRole, text } from "./dom-queries.mjs";
import { installRendererApi } from "./renderer-api.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationLabels } from "../fixtures/app-navigation-data.mjs";

export { dom, act, click, restoreGlobals };
export { input, keyDown, mouseDown, hover } from "./dom-events.mjs";

const PAGE_TIMEOUT = 5000;
const BOOT_TIMEOUT = 10000;
const NARROW_WIDTH = 480;

let narrowViewport = null;

function narrowMatchMedia(query) {
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  const matches =
    Boolean(max || min) && (!max || NARROW_WIDTH <= Number(max[1])) && (!min || NARROW_WIDTH >= Number(min[1]));
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  };
}

function useNarrowViewport(t) {
  if (!narrowViewport) {
    narrowViewport = ["matchMedia", "innerWidth"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(dom.window, name),
    ]);
    Object.defineProperty(dom.window, "matchMedia", { configurable: true, writable: true, value: narrowMatchMedia });
    Object.defineProperty(dom.window, "innerWidth", { configurable: true, writable: true, value: NARROW_WIDTH });
  }
  t.after(() => {
    if (!narrowViewport) return;
    for (const [name, descriptor] of narrowViewport) {
      if (descriptor) Object.defineProperty(dom.window, name, descriptor);
      else delete dom.window[name];
    }
    narrowViewport = null;
  });
}

export function waitFor(check, { timeout = PAGE_TIMEOUT } = {}) {
  return waitForPage(check, { timeout });
}

let application;
function applicationBundle() {
  application ??= loadRenderer("app-navigation-production-entry", 'export {App} from "./src/renderer/App.tsx";');
  return application;
}

export function exposed(element) {
  for (let current = element; current; current = current.parentElement) {
    const style = current.ownerDocument.defaultView.getComputedStyle(current);
    if (
      current.hidden ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden"
    )
      return false;
  }
  return true;
}

export function textBlocks(root) {
  return [root, ...root.querySelectorAll("*")]
    .filter(exposed)
    .map((element) =>
      [...element.childNodes]
        .filter((node) => node.nodeType === node.TEXT_NODE)
        .map((node) => node.textContent)
        .join("")
        .trim(),
    )
    .filter(Boolean);
}

export function roles(root, role, name) {
  return allByRole(root, role, name).filter(exposed);
}

export function control(root, role, name) {
  const elements = roles(root, role, name);
  assert.equal(elements.length, 1, `Expected one visible ${role} named ${name}; found ${elements.length}`);
  return elements[0];
}

export function visibleText(root, value) {
  const element = text(root, value);
  assert.ok(element && exposed(element), `Expected visible text: ${value}`);
  return element;
}

export function pathChoice(root, path) {
  // Both the visible path and its public tooltip identify a folder to a user.
  // No component classes, generated IDs, or parent/child layout assumptions.
  const matches = [
    ...new Set(["button", "menuitem", "menuitemradio", "option"].flatMap((role) => roles(root, role))),
  ].filter((element) => element.title === path || element.textContent.trim() === path);
  assert.equal(matches.length, 1, `Expected one visible folder choice for ${path}`);
  return matches[0];
}

export function menuActions(root, name) {
  return [...new Set(["button", "menuitem"].flatMap((role) => roles(root, role, name)))];
}

export function menuAction(root, name) {
  const matches = menuActions(root, name);
  assert.equal(matches.length, 1, `Expected one visible menu action named ${name}`);
  return matches[0];
}

export function historyRows(scene, ...titles) {
  const history = scene.history();
  for (const title of titles) control(history, "button", title);
  return history;
}

export function historyRowsWithStatus(scene, title, status) {
  return roles(scene.history(), "button").filter((element) => {
    const name = accessibleName(element);
    return name !== title && name.includes(title) && name.includes(status) && !name.startsWith("Session actions");
  });
}

export function historyRow(scene, title) {
  const matches = roles(scene.history(), "button").filter((element) => {
    const name = accessibleName(element);
    return name.includes(title) && !name.startsWith("Session actions");
  });
  assert.equal(matches.length, 1, `Expected one history row for ${title}; found ${matches.length}`);
  return matches[0];
}

export function currentPages(scene) {
  return [...scene.navigation().querySelectorAll('[aria-current="page"]')].map(accessibleName);
}

export function onChatPage(scene) {
  const chat = control(scene.container, "region", "Chat");
  assert.equal(roles(scene.container, "heading", "Plugins & Skills").length, 0, "Resources is not the page shown");
  const marked = currentPages(scene);
  for (const entry of ["Plugins & Skills", "New session"])
    assert.equal(marked.includes(entry), false, `${entry} is not the current page`);
  return chat;
}

export function noHistoryRows(scene, ...titles) {
  for (const title of titles) assert.equal(roles(scene.history(), "button", title).length, 0, `${title} is not shown`);
}

export async function expectScope(scene, source, { absent = [] } = {}) {
  await waitFor(() => visibleText(scene.resourcePanel(), source));
  visibleText(scene.resourcePanel(), "npm:shared-navigation-plugin");
  for (const other of absent)
    assert.ok(!scene.resourcePanel().textContent.includes(other), `${other} is not in this space`);
}

export async function startNavigation(t, options = {}, external = navigationBoundary(options)) {
  const api = await applicationBundle();
  const language = options.language ?? "en-US";
  const labels = navigationLabels[language];
  assert.ok(labels, `Unsupported navigation fixture language: ${language}`);
  dom.window.localStorage.clear();
  dom.window.history.replaceState(null, "", options.initialSession ? `/?session=${options.initialSession}` : "/");
  api.setAppLanguage(language);
  if (options.viewport === "narrow") useNarrowViewport(t);
  const boundary = installRendererApi(dom.window, api, () => external.host, { bridge: external.bridge });
  const view = await mount(t, api.App, {}, { release: boundary.close });
  t.after(() => external.releaseHolds());
  t.after(() => assert.deepEqual(external.unexpected, [], "the App made no request outside the fixture contract"));
  // Establish a healthy real App before looking for any proposed navigation.
  // Connection errors, error-boundary fallback and empty bootstrap cannot be Red.
  await waitFor(() => control(view.container, "button", labels.filePanel), { timeout: BOOT_TIMEOUT });
  assert.doesNotMatch(
    view.container.textContent,
    /UI crashed|Cannot connect to Agent Host|Unexpected navigation boundary request/,
  );
  const scene = {
    ...view,
    external,
    labels,
    async reload() {
      const initialSession = new dom.window.URLSearchParams(dom.window.location.search).get("session");
      await view.unmount();
      return startNavigation(t, { ...options, initialSession }, external);
    },
    navigation: () => control(view.container, "navigation", labels.navigation),
    history: () => control(scene.navigation(), "navigation", labels.history),
    workspace: () => control(scene.navigation(), "group", "Workspace controls"),
    resourcePanel: () => control(view.container, "tabpanel"),
    // Waits until no Host request or desktop bridge call is in flight and one
    // more turn starts nothing new. Work scheduled behind a timer (debounce,
    // delayed notices) can start after this returns, so "nothing appeared"
    // checks only cover request-driven updates.
    async settled({ held = 0 } = {}) {
      const deadline = Date.now() + PAGE_TIMEOUT;
      for (;;) {
        const before = external.activity();
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
        const after = external.activity();
        if (before.pending === held && after.pending === held && after.started === before.started) return;
        if (Date.now() >= deadline) throw new Error("Host requests did not settle");
      }
    },
    async overview() {
      await click(control(scene.navigation(), "button", labels.resources));
      return waitFor(() => {
        control(view.container, "heading", labels.resources);
        return control(view.container, "button", labels.manageSources);
      });
    },
    async resources() {
      await click(control(scene.navigation(), "button", labels.resources));
      await waitFor(() => control(view.container, "heading", labels.resources));
      const manage = roles(view.container, "button", labels.manageSources);
      if (manage.length) await click(manage[0]);
      return waitFor(() => scene.resourcePanel());
    },
    async skills(name = "personal-checklist") {
      await scene.resources();
      await click(control(view.container, "tab", labels.skills));
      await waitFor(() => visibleText(scene.resourcePanel(), name));
      await click(visibleText(scene.resourcePanel(), name));
      return waitFor(() => control(scene.resourcePanel(), "region", labels.skillContent));
    },
    // The project card floats above the page, so it is looked up in the whole
    // document rather than inside the navigation it was opened from.
    async menu(space = labels.personal) {
      await click(control(scene.navigation(), "button", labels.switcher));
      return waitFor(() => control(dom.window.document.body, "menu", space));
    },
    // The real working directory, observed where it leaves the App: the folder
    // the App hands to the desktop to remember as the current space. Waiting
    // for quiet first means a pending change is reported, not the previous one.
    async currentFolder() {
      await scene.settled();
      const folder = external.rememberedSpace();
      assert.ok(folder, "the App told the desktop which folder is the current space");
      return folder;
    },
    async settings() {
      await click(control(scene.navigation(), "button", labels.settings));
      return waitFor(() => control(view.container, "region", labels.settings));
    },
    async desktopMenu(command) {
      await act(async () => external.menu(command));
      return waitFor(() => control(view.container, "region", labels.settings));
    },
  };
  return scene;
}

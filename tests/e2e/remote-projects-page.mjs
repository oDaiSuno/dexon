import { createRemoteSettingsDriver } from "./remote-settings-page.mjs";

export const remoteProjectSelectors = {
  list: '[role="list"][aria-label="Project spaces"]',
  composer: '[role="textbox"][contenteditable="true"]',
  attribution: ".composer-environment-strip",
  welcome: ".remote-daemon-capsule",
  topbar: ".top-bar-server-status",
  banner: ".reconnect-banner",
  panel: ".right-panel-container",
};

export function remoteProjectsPage(operation, args = {}) {
  const { document, getComputedStyle } = globalThis;
  const exposed = (element) => {
    if (!element?.getClientRects().length) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.hasAttribute("inert") || current.getAttribute("aria-hidden") === "true")
        return false;
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  };
  const projectRows = () =>
    [...document.querySelectorAll('[role="list"][aria-label="Project spaces"] [data-project-row]')].filter(exposed);
  const projectParent = (row) => row.closest('[role="listitem"]');
  const rootFor = (target) => {
    if (!target.project) return document;
    const rows = projectRows().filter((row) => {
      const parent = projectParent(row);
      const host = parent.querySelector("[data-project-host]");
      return (
        parent.getAttribute("title") === target.project.path &&
        (target.project.server ? host?.getAttribute("aria-label")?.includes(target.project.server) : !host)
      );
    });
    if (rows.length > 1) throw new Error("Ambiguous visible project identity");
    return rows[0] ? projectParent(rows[0]) : null;
  };
  const candidates = (target) => {
    const root = rootFor(target);
    return root
      ? [...root.querySelectorAll(target.selector)].filter(
          (element) =>
            exposed(element) &&
            (target.text === undefined || element.textContent.trim() === target.text) &&
            (target.includes === undefined ||
              element.textContent.toLocaleLowerCase().includes(target.includes.toLocaleLowerCase())),
        )
      : [];
  };
  const find = (target) => {
    const found = candidates(target);
    if (target.index !== undefined) return found[target.index] ?? null;
    if (found.length > 1) throw new Error(`Ambiguous visible selector ${target.selector}`);
    return found[0] ?? null;
  };
  const rectOf = (element) => {
    const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
    return { x, y, width, height, right, bottom };
  };
  const describe = (element) => {
    const style = getComputedStyle(element);
    return {
      text: element.innerText ?? element.textContent,
      name: element.getAttribute("aria-label"),
      title: element.getAttribute("title"),
      role: element.getAttribute("role"),
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
      current: element.getAttribute("aria-current"),
      expanded: element.getAttribute("aria-expanded"),
      describedBy: element.getAttribute("aria-describedby"),
      description:
        element
          .getAttribute("aria-describedby")
          ?.split(/\s+/u)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim() ?? "",
      rect: rectOf(element),
      style: {
        color: style.color,
        background: style.backgroundColor,
        border: style.borderStyle,
        borderColor: style.borderColor,
      },
    };
  };
  if (operation === "rows")
    return projectRows().map((row) => {
      const parent = projectParent(row);
      const host = parent.querySelector("[data-project-host]");
      const glyph = row.querySelector('[data-project-glyph="server"]');
      const chevron = row.querySelector('[data-project-glyph="chevron"]');
      const label = row.querySelector("span.type-body-large, span.type-body-large-medium");
      return {
        ...describe(row),
        path: parent.getAttribute("title"),
        tone: parent.getAttribute("data-tone"),
        host: host ? describe(host) : null,
        glyph: glyph ? describe(glyph) : null,
        chevron: chevron ? describe(chevron) : null,
        label: label ? describe(label) : null,
      };
    });
  if (operation === "all") return candidates(args).map(describe);
  if (operation === "exists") return Boolean(find(args));
  if (operation === "text") return find(args)?.innerText ?? "";
  if (operation === "draft")
    return (
      [...document.querySelectorAll('[role="textbox"][contenteditable="true"]')].find(exposed)?.textContent ?? null
    );
  if (operation === "focus-matches") return document.hasFocus() && candidates(args).includes(document.activeElement);
  if (operation === "point") {
    const element = find(args);
    if (!element) return { blocked: `Missing visible selector ${args.selector}` };
    if (!args.allowDisabled && (element.disabled || element.getAttribute("aria-disabled") === "true"))
      return { blocked: `Visible control is disabled ${args.selector}` };
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const point = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    if (!element.contains(document.elementFromPoint(point.x, point.y)))
      return { blocked: `Visible control is covered ${args.selector}` };
    return point;
  }
  if (operation === "image") {
    const element = [...document.querySelectorAll("img")].find((image) => exposed(image) && image.alt === args.path);
    if (!element || !element.complete || element.naturalWidth === 0) return null;
    return { src: element.src, width: element.naturalWidth, height: element.naturalHeight, rect: rectOf(element) };
  }
  throw new Error(`Unknown remote project observation ${operation}`);
}

export function createRemoteProjectsDriver({ window, output }) {
  const base = createRemoteSettingsDriver({ window, output });
  const read = (operation, args = {}) =>
    base.js(`(${remoteProjectsPage.toString()})(${JSON.stringify(operation)},${JSON.stringify(args)})`);
  const frames = () => base.js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const clickCss = async (target, button = "left") => {
    const deadline = Date.now() + 10000;
    let previous;
    for (;;) {
      const point = await read("point", target);
      if (!point.blocked && previous && point.x === previous.x && point.y === previous.y) {
        window.webContents.sendInputEvent({ type: "mouseMove", ...point });
        window.webContents.sendInputEvent({ type: "mouseDown", button, clickCount: 1, ...point });
        window.webContents.sendInputEvent({ type: "mouseUp", button, clickCount: 1, ...point });
        await frames();
        return;
      }
      if (Date.now() >= deadline) throw new Error(point.blocked ?? `Visible control did not settle ${target.selector}`);
      previous = point.blocked ? null : point;
      await frames();
    }
  };
  const hover = async (target) => {
    const point = await read("point", { ...target, allowDisabled: true });
    if (point.blocked) throw new Error(point.blocked);
    window.webContents.sendInputEvent({ type: "mouseMove", ...point });
    await frames();
  };
  const focusCss = async (target) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await read("focus-matches", target)) return;
      await base.key("Tab");
    }
    throw new Error(`Native Tab did not reach ${target.selector}`);
  };
  const fillDraft = async (value) => {
    window.show();
    window.focus();
    window.webContents.focus();
    await clickCss({ selector: remoteProjectSelectors.composer });
    await base.waitFor(
      () => read("focus-matches", { selector: remoteProjectSelectors.composer }),
      "the native composer owns keyboard focus before editing",
    );
    window.webContents.selectAll();
    await frames();
    if (value) await window.webContents.insertText(value);
    else await base.key("Backspace");
    await frames();
    await base.waitFor(async () => (await read("draft")) === value, "the draft entered by native input");
  };
  const row = async (view, project) =>
    (await read("rows")).find((item) => item.path === project && item.host?.name?.includes(view.label));
  const rowTarget = (view, project, selector = "[data-project-row]") => ({
    project: { path: project, server: view.label },
    selector,
  });
  const openMenu = async (view, project) => {
    const target = rowTarget(view, project);
    await hover(target);
    await clickCss(rowTarget(view, project, 'button[aria-haspopup="menu"]'));
    await base.waitFor(
      () => base.exists({ role: "menu", name: project.split(/[\\/]/u).pop() }),
      "the remote project menu",
    );
  };
  const closeSettings = async () => {
    if (!(await base.exists({ role: "region", name: "Settings" }))) return;
    await base.click({ role: "tab", name: "Servers" });
    await base.key("Escape");
    await base.waitFor(async () => !(await base.exists({ role: "region", name: "Settings" })), "Settings closed");
  };
  const showPanel = async () => {
    if (await base.exists({ role: "button", name: "Show file panel" }))
      await base.click({ role: "button", name: "Show file panel" });
    await base.waitFor(() => read("exists", { selector: remoteProjectSelectors.panel }), "the production right panel");
  };
  const blobText = async (url) => {
    if (!/^blob:app:\/\/bundle\/[0-9a-f-]+$/u.test(url)) throw new Error("Expected the production image's blob URL");
    const inspector = window.webContents.debugger;
    const attached = inspector.isAttached();
    if (!attached) inspector.attach("1.3");
    try {
      await inspector.sendCommand("Page.enable");
      const { frameTree } = await inspector.sendCommand("Page.getFrameTree");
      const resource = await inspector.sendCommand("Page.getResourceContent", { frameId: frameTree.frame.id, url });
      return Buffer.from(resource.content, resource.base64Encoded ? "base64" : "utf8").toString("utf8");
    } finally {
      if (!attached) inspector.detach();
    }
  };
  return {
    ...base,
    read,
    clickCss,
    hover,
    focusCss,
    fillDraft,
    row,
    rowTarget,
    openMenu,
    closeSettings,
    showPanel,
    blobText,
  };
}

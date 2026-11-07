import fs from "node:fs";
import path from "node:path";

export function remoteSettingsPage(operation, args = {}) {
  const { document, getComputedStyle } = globalThis;
  const implicit = {
    button: "button,summary",
    textbox:
      'textarea,input:not([type]),input[type="text"],input[type="password"],input[type="url"],input[type="search"]',
    spinbutton: 'input[type="number"]',
    combobox: "select",
    checkbox: 'input[type="checkbox"]:not([role="switch"])',
    radio: 'input[type="radio"]',
    region: "section[aria-label],section[aria-labelledby]",
    field: "input,textarea,select",
    navigation: "nav",
    heading: "h1,h2,h3,h4,h5,h6",
    article: "article",
    list: "ul,ol",
  };
  const nameOf = (element) => {
    if (!element) return "";
    const labelled = element
      .getAttribute("aria-labelledby")
      ?.split(/\s+/u)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    const labels = element.labels ? [...element.labels].map((label) => label.textContent).join(" ") : "";
    return (labelled || element.getAttribute("aria-label") || labels || element.textContent || "")
      .replace(/\s+/gu, " ")
      .trim();
  };
  const exposed = (element) => {
    if (!element?.getClientRects().length) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (
        current.hidden ||
        current.hasAttribute("inert") ||
        current.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden"
      )
        return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const matches = (element, target) => {
    const actual = nameOf(element).toLowerCase();
    const wanted = target.name?.toLowerCase();
    return wanted === undefined || (target.contains ? actual.includes(wanted) : actual === wanted);
  };
  const elements = (target, root = document) => {
    const selector = [`[role="${target.role}"]`, implicit[target.role]].filter(Boolean).join(",");
    return [...root.querySelectorAll(selector)].filter((element) => exposed(element) && matches(element, target));
  };
  const find = (target, root = document) => {
    const found = elements(target, root);
    if (found.length > 1) throw new Error(`Ambiguous public control ${target.role}: ${target.name}`);
    return found[0] ?? null;
  };
  const root = args.scope ? find(args.scope) : document;
  const rectOf = (element) => {
    if (!element) return null;
    const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
    return { x, y, width, height, right, bottom };
  };
  const describe = (element) => ({
    role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
    name: nameOf(element),
    rect: rectOf(element),
    disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
    checked: "checked" in element ? element.checked : element.getAttribute("aria-checked"),
    selected: element.getAttribute("aria-selected"),
  });
  if (operation === "text") return (root === document ? document.body : root)?.innerText ?? "";
  if (operation === "exists") return Boolean(root && find(args, root));
  if (operation === "attribute") return root && find(args, root)?.getAttribute(args.attribute);
  if (operation === "value") return root && find(args, root)?.value;
  if (operation === "checked") return root && find(args, root)?.checked;
  if (operation === "elements") return root ? elements(args, root).map(describe) : [];
  if (operation === "tabs") {
    const settings = find({ role: "region", name: "Settings" });
    return settings ? elements({ role: "tab" }, settings).map(describe) : [];
  }
  if (operation === "theme") return document.documentElement.classList.contains("dark") ? "dark" : "light";
  if (operation === "focus") {
    const element = document.activeElement;
    return {
      ...describe(element),
      visible: exposed(element),
      focusVisible: element.matches(":focus-visible"),
      documentFocused: document.hasFocus(),
      value: element.value ?? null,
      selectionStart: element.selectionStart ?? null,
      selectionEnd: element.selectionEnd ?? null,
    };
  }
  if (operation === "point") {
    if (!root) return { blocked: `Missing public scope ${args.scope?.name}` };
    const element = args.text
      ? [...root.querySelectorAll("*")].find(
          (candidate) =>
            exposed(candidate) &&
            candidate.textContent.trim() === args.text &&
            ![...candidate.children].some((child) => child.textContent.trim() === args.text),
        )
      : find(args, root);
    if (!element) return { blocked: `Missing public control ${args.role ?? "text"}: ${args.name ?? args.text}` };
    if (element.disabled || element.getAttribute("aria-disabled") === "true") {
      return { blocked: `Public control is disabled: ${args.name}` };
    }
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const point = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    if (!element.contains(document.elementFromPoint(point.x, point.y))) {
      return { blocked: `Public control is covered: ${args.name ?? args.text}` };
    }
    return point;
  }
  if (operation === "columns") {
    return root
      ? [...root.querySelectorAll("ul[aria-label]")].filter(exposed).map((element) => ({
          name: nameOf(element),
          text: element.innerText,
          rect: rectOf(element),
        }))
      : [];
  }
  if (operation === "definitions") {
    return root
      ? [...root.querySelectorAll("dt")].filter(exposed).map((element) => ({
          name: element.textContent.trim(),
          value: element.nextElementSibling?.textContent.trim() ?? "",
        }))
      : [];
  }
  if (operation === "report") {
    if (!root) return null;
    const headings = elements({ role: "heading" }, root).map(nameOf);
    return { text: root.innerText, headings, controls: elements({ role: "button" }, root).map(describe) };
  }
  if (operation === "diagnostics") {
    return {
      text: document.body.innerText,
      controls: [
        ...document.querySelectorAll(
          'button,summary,input,select,[role="tab"],[role="dialog"],[role="region"],[role="group"],[role="list"],[role="listbox"]',
        ),
      ]
        .filter(exposed)
        .map(describe),
      focus: describe(document.activeElement),
      viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
    };
  }
  throw new Error(`Unknown public page observation ${operation}`);
}

export function createRemoteSettingsDriver({ window, output }) {
  const themeAttempts = [];
  const observe = async (action, description) => {
    let timer;
    try {
      return await Promise.race([
        action(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${description} exceeded 20s`)), 20000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const js = (code) => observe(() => window.webContents.executeJavaScript(code, true), "Production page observation");
  const page = (operation, args = {}) =>
    js(`(${remoteSettingsPage.toString()})(${JSON.stringify(operation)}, ${JSON.stringify(args)})`);
  const exists = (target) => page("exists", target);
  const bridge = (method, argument) => {
    if (!["listEnvironments", "environmentCommand", "getUiState"].includes(method)) {
      throw new Error(`Unsupported production bridge operation ${method}`);
    }
    return js(`window.piBridge[${JSON.stringify(method)}](${argument === undefined ? "" : JSON.stringify(argument)})`);
  };
  const waitFor = async (check, description, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (!(await check())) {
      if (Date.now() >= deadline) throw new Error(`Production page did not show ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const frames = () => js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const key = async (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    if (keyCode === "Enter") window.webContents.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
    else if (keyCode.length === 1 && modifiers.length === 0) {
      window.webContents.sendInputEvent({ type: "char", keyCode, modifiers });
    }
    window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await frames();
  };
  const click = async (target) => {
    if (!target.text) await waitFor(() => exists(target), `${target.name} ready for native input`);
    const deadline = Date.now() + 5000;
    let previous;
    for (;;) {
      const point = await page("point", target);
      if (!point.blocked && previous && point.x === previous.x && point.y === previous.y) {
        window.webContents.sendInputEvent({ type: "mouseMove", ...point });
        window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
        window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
        await frames();
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(point.blocked ?? `Public control did not settle: ${target.name ?? target.text}`);
      }
      previous = point.blocked ? null : point;
      await frames();
    }
  };
  const fill = async (name, value, scope) => {
    const target = { role: "field", name, scope };
    await click(target);
    window.webContents.selectAll();
    await frames();
    const selection = await page("focus");
    if (
      typeof selection.selectionStart === "number" &&
      (selection.selectionStart !== 0 || selection.selectionEnd !== selection.value.length)
    ) {
      throw new Error(`Native Select All did not select the complete ${name} field`);
    }
    if (value) await observe(() => window.webContents.insertText(String(value)), "Native text input");
    else await key("Backspace");
    await waitFor(async () => (await page("value", target)) === String(value), `${name} entered through native input`);
  };
  const screenshot = async (name, settle = true) => {
    if (settle) await frames();
    const image = await observe(() => window.webContents.capturePage(), "Production screenshot");
    fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
    fs.writeFileSync(path.join(output, `${name}-small.png`), image.resize({ width: 640 }).toPNG());
    return `${name}.png`;
  };
  const ready = async () => {
    await waitFor(
      () => js("Boolean(window.piBridge && document.getElementById('root')?.childElementCount)"),
      "production preload and renderer",
      20000,
    );
    await waitFor(
      async () =>
        (await bridge("listEnvironments")).environments.some(
          (view) => view.id === "primary" && view.status.phase === "connected",
        ),
      "the real primary Agent Host",
      20000,
    );
    window.show();
    window.focus();
    window.webContents.focus();
  };
  const reload = async () => {
    let timer;
    let loaded;
    try {
      await new Promise((resolve, reject) => {
        loaded = resolve;
        window.webContents.once("did-finish-load", loaded);
        timer = setTimeout(() => reject(new Error("Production reload exceeded 20s")), 20000);
        window.webContents.reload();
      });
      await ready();
    } finally {
      clearTimeout(timer);
      window.webContents.removeListener("did-finish-load", loaded);
    }
  };
  const settings = async () => {
    if (!(await exists({ role: "region", name: "Settings" }))) await click({ role: "button", name: "Settings" });
    await waitFor(() => exists({ role: "region", name: "Settings" }), "Settings");
  };
  const theme = async (value) => {
    await settings();
    await click({ role: "tab", name: "General" });
    if ((await page("theme")) !== value) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await page("focus")).name === "Theme") break;
        if (attempt === 99) throw new Error("Native Tab did not reach the Theme selector");
        await key("Tab");
      }
      const attempt = { target: value, before: await page("focus"), input: value[0].toUpperCase() };
      themeAttempts.push(attempt);
      try {
        await key(attempt.input);
        await waitFor(async () => (await page("theme")) === value, `the ${value} theme`);
      } finally {
        attempt.after = await page("focus");
        attempt.result = await page("theme");
        fs.writeFileSync(path.join(output, "native-theme-attempts.json"), JSON.stringify(themeAttempts, null, 2));
      }
    }
    await click({ role: "tab", name: "Servers" });
  };
  return { js, page, exists, bridge, waitFor, key, click, fill, screenshot, ready, reload, settings, theme };
}

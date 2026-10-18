// Serialized into Chromium by the native harness. Only public page state is
// read: roles/names, text, form values, focus, hit-testing and rendered geometry.
// It never reads React state, controller refs or test-only product exports.
export function productionPage(operation, args = {}) {
  const { document, getComputedStyle } = globalThis;
  const implicit = { button: "button", textbox: "textarea", navigation: "nav", heading: "h1,h2,h3,h4,h5,h6" };
  const nameOf = (element) => {
    const labelled = element
      .getAttribute("aria-labelledby")
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    return (labelled || element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim();
  };
  const exposed = (element) => {
    if (!element || !element.getClientRects().length) return false;
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
  const sameName = (left, right) => left.toLowerCase() === right.toLowerCase();
  const find = (role, name, root = document) => {
    const selector = [`[role="${role}"]`, implicit[role]].filter(Boolean).join(",");
    const matches = [...root.querySelectorAll(selector)].filter(
      (element) => exposed(element) && (name === undefined || sameName(nameOf(element), name)),
    );
    if (matches.length > 1) throw new Error(`Ambiguous public control ${role}: ${name}`);
    return matches[0] ?? null;
  };
  const nav = () => find("navigation", "Main navigation");
  const rectOf = (element) => {
    if (!element) return null;
    const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
    return { x, y, width, height, right, bottom };
  };
  if (operation === "text") return document.body.innerText;
  if (operation === "exists") return Boolean(find(args.role, args.name));
  if (operation === "attribute") return find(args.role, args.name)?.getAttribute(args.attribute) ?? null;
  if (operation === "value") return find(args.role, args.name)?.value ?? null;
  if (operation === "point") {
    const element = args.text
      ? [...document.querySelectorAll("*")].find(
          (candidate) =>
            exposed(candidate) &&
            candidate.textContent.trim() === args.text &&
            ![...candidate.children].some((child) => child.textContent.trim() === args.text),
        )
      : find(args.role, args.name);
    if (!element) throw new Error(`Missing production control ${args.role ?? "text"}: ${args.name ?? args.text}`);
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const point = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    if (!element.contains(document.elementFromPoint(point.x, point.y)))
      throw new Error(`Production control is covered: ${args.name}`);
    return point;
  }
  if (operation === "navigation") {
    const element = nav();
    if (!element) return null;
    return {
      rect: rectOf(element),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      documentWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      buttons: [...element.querySelectorAll("button")].filter(exposed).map(nameOf),
      workspace: rectOf(find("group", "Workspace controls", element)),
      resourceHeading: rectOf(find("heading", "Plugins & Skills")),
      currentPage: [...element.querySelectorAll('[aria-current="page"]')].filter(exposed).map(nameOf),
    };
  }
  if (operation === "selection") {
    const element = document.activeElement;
    return {
      name: nameOf(element),
      focused: document.hasFocus(),
      start: element.selectionStart,
      end: element.selectionEnd,
      length: element.value?.length,
    };
  }
  if (operation === "settingsTabs") {
    const settings = find("dialog", "Settings");
    return settings ? [...settings.querySelectorAll('[role="tab"]')].filter(exposed).map(nameOf) : null;
  }
  if (operation === "focus") {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      name: nameOf(element),
      rect: rectOf(element),
      visible: exposed(element),
      inNavigation: Boolean(nav()?.contains(element)),
      hit: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
      focusVisible: element.matches(":focus-visible"),
      outlineWidth: parseFloat(style.outlineWidth),
      outlineStyle: style.outlineStyle,
    };
  }
  throw new Error(`Unknown public page observation ${operation}`);
}

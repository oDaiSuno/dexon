export function projectListPage(operation, args = {}) {
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
  const projectList = () => {
    const history = find("navigation", "Project spaces", nav());
    return history ? find("list", "Project spaces", history) : null;
  };
  const projectItems = () => {
    const list = projectList();
    if (!list) return [];
    return [...list.querySelectorAll('[role="listitem"]')].filter(
      (item) => exposed(item) && item.parentElement?.closest('[role="list"]') === list,
    );
  };
  const projectName = (item) => {
    const toggle = [...item.querySelectorAll("button[aria-expanded]:not([aria-haspopup])")].find(exposed);
    return toggle ? nameOf(toggle) : "";
  };
  const projectItem = (name) => projectItems().find((item) => projectName(item) === name) ?? null;
  const center = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  };
  if (operation === "order") return projectItems().map(projectName);
  if (operation === "rowPoint") {
    const item = projectItem(args.name);
    if (!item) throw new Error(`Missing project row ${args.name}`);
    item.scrollIntoView({ block: "nearest" });
    const toggle = [...item.querySelectorAll("button[aria-expanded]:not([aria-haspopup])")].find(exposed);
    return center(toggle);
  }
  if (operation === "rowText") return projectItem(args.name)?.innerText ?? null;
  if (operation === "isCurrent") {
    const item = projectItem(args.name);
    if (!item) return false;
    const toggle = [...item.querySelectorAll("button[aria-expanded]:not([aria-haspopup])")].find(exposed);
    return toggle ? toggle.getAttribute("aria-current") === "location" : false;
  }
  if (operation === "rowNameColor") {
    const item = projectItem(args.name);
    if (!item) return null;
    const label = [...item.querySelectorAll("*")].find(
      (element) => exposed(element) && element.childElementCount === 0 && element.textContent.trim() === args.name,
    );
    return label ? getComputedStyle(label).color : null;
  }
  if (operation === "tokenColor") {
    const probe = document.createElement("span");
    probe.style.color = `var(${args.token})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }
  if (operation === "exists") return Boolean(find(args.role, args.name));
  if (operation === "point") {
    const element = find(args.role, args.name);
    if (!element) throw new Error(`Missing control ${args.role}: ${args.name}`);
    return center(element);
  }
  if (operation === "text") return document.body.innerText;
  throw new Error(`Unknown project list observation ${operation}`);
}

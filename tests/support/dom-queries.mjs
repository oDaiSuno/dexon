// Page queries are shared by DOM fixtures and native Electron scenes. They
// depend only on the rendered page, not on React or a particular DOM runtime.
export function accessibleName(element) {
  const ids = element.getAttribute("aria-labelledby")?.trim().split(/\s+/);
  const labelled = ids
    ?.map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
  return (labelled || element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim();
}

function roleElements(container, role) {
  const implicit = {
    button: "button",
    textbox: 'textarea,input:not([type]),input[type="text"]',
    searchbox: 'input[type="search"]',
    heading: "h1,h2,h3,h4,h5,h6",
    region: "section[aria-label],section[aria-labelledby]",
    navigation: "nav",
    main: "main",
  };
  const selectors = [`[role="${role}"]`, implicit[role]].filter(Boolean).join(",");
  return [...container.querySelectorAll(selectors)];
}

function matchesName(element, name) {
  if (name === undefined) return true;
  const value = accessibleName(element);
  return name instanceof RegExp ? name.test(value) : value === name;
}

export function allByRole(container, role, name) {
  return roleElements(container, role).filter((element) => matchesName(element, name));
}

export function byRole(container, role, name) {
  return roleElements(container, role).find((element) => matchesName(element, name));
}

export function getByRole(container, role, name) {
  const matches = allByRole(container, role, name);
  if (matches.length !== 1) {
    throw new Error(`Expected one ${role}${name === undefined ? "" : ` named ${name}`}; found ${matches.length}`);
  }
  return matches[0];
}

export function button(container, label) {
  return byRole(container, "button", label);
}

export function text(container, value) {
  return [...container.querySelectorAll("*")].find(
    (element) =>
      element.textContent.trim() === value &&
      ![...element.children].some((child) => child.textContent.trim() === value),
  );
}

// Labels are the caller-visible identity of form controls, independent of
// render order, generated IDs or extra settings added beside them.
export function labelledControl(container, label) {
  const match = [...container.querySelectorAll("label[for]")].find((node) => node.textContent.trim() === label);
  const control = match?.control;
  if (!control || !container.contains(control)) throw new Error(`Missing labelled control: ${label}`);
  return control;
}

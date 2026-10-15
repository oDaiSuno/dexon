import { act } from "react";
export { accessibleName, allByRole, byRole, getByRole, button, text, labelledControl } from "./dom-queries.mjs";

// Use the control's own browser. Importing an event helper must not install a
// second JSDOM window over a composer's or composition fixture's environment.
const browserOf = (element) => element.ownerDocument.defaultView;

function requireControl(element) {
  if (!element?.isConnected) throw new Error("The requested page control was not found");
  if (element.disabled) throw new Error("The requested page control is disabled");
  for (let current = element; current; current = current.parentElement) {
    const style = browserOf(current).getComputedStyle(current);
    if (
      current.hidden ||
      current.inert ||
      current.hasAttribute("inert") ||
      style.display === "none" ||
      style.visibility === "hidden"
    ) {
      throw new Error("The requested page control is hidden");
    }
  }
  return element;
}

export async function click(element) {
  requireControl(element);
  await act(async () => element.click());
}

export async function input(element, value) {
  requireControl(element);
  const dom = { window: browserOf(element) };
  const prototype =
    element.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  await act(async () => {
    element.focus();
    setter.call(element, value);
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

export async function selectOption(element, value) {
  requireControl(element);
  const dom = { window: browserOf(element) };
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set;
  await act(async () => {
    element.focus();
    setter.call(element, value);
    element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

export async function keyDown(element, key, options = {}) {
  requireControl(element);
  const dom = { window: browserOf(element) };
  const event = new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => {
    element.focus?.();
    element.dispatchEvent(event);
  });
  return event;
}

export async function mouseDown(element, options = {}) {
  requireControl(element);
  const event = new (browserOf(element).MouseEvent)("mousedown", { bubbles: true, cancelable: true, ...options });
  await act(async () => element.dispatchEvent(event));
  return event;
}

export async function hover(element) {
  requireControl(element);
  await act(async () => element.dispatchEvent(new (browserOf(element).MouseEvent)("mouseover", { bubbles: true })));
}

// Wait for an observable page condition, not for a particular implementation
// delay. The deadline prevents a broken transition from hanging the suite.
export async function waitFor(check, { timeout = 1500 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      return check();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
  }
}

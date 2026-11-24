import { act, button, dom } from "./renderer.mjs";

export function installSelectionGeometry(t) {
  const prototype = dom.window.Range.prototype;
  const names = ["getClientRects", "getBoundingClientRect"];
  const originals = names.map((name) => Object.getOwnPropertyDescriptor(prototype, name));
  const rect = { top: 120, bottom: 140, left: 40, right: 240, width: 200, height: 20 };
  prototype.getClientRects = () => [rect];
  prototype.getBoundingClientRect = () => rect;
  t.after(() => {
    dom.window.getSelection().removeAllRanges();
    names.forEach((name, index) => {
      if (originals[index]) Object.defineProperty(prototype, name, originals[index]);
      else delete prototype[name];
    });
  });
}

export async function selectText(start, end = start, { collapsed = false, event = "mouseup" } = {}) {
  await act(async () => {
    const range = dom.window.document.createRange();
    range.selectNodeContents(start);
    if (end !== start) range.setEnd(end, end.childNodes.length);
    if (collapsed) range.collapse(true);
    const selection = dom.window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    end.dispatchEvent(new dom.window.Event(event, { bubbles: true }));
  });
}

export const askButton = () => button(dom.window.document.body, /^(Ask Dexon|继续询问 Dexon)$/);

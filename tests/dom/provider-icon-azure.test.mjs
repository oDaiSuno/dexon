import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createElement, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";

const { ProviderIcon } = await loadRenderer(
  "provider-icon-azure",
  'export {ProviderIcon} from "./src/renderer/components/models/provider-icon.tsx";',
);
after(restoreGlobals);

const MISSING_ICON = "missing-icon";

async function renderIcon(t, id) {
  const view = await mount(t, ProviderIcon, {
    id,
    size: 20,
    fallback: createElement("span", { "data-testid": MISSING_ICON }),
  });
  return view.container;
}

test("the Azure channel shows its own logo instead of the missing-logo placeholder", async (t) => {
  const container = await renderIcon(t, "azure");
  assert.equal(container.querySelector(`[data-testid="${MISSING_ICON}"]`), null);
  assert.ok(container.querySelector("svg"), "a logo is drawn");
});

test("the Azure logo is different from the OpenAI logo", async (t) => {
  const azure = await renderIcon(t, "azure");
  const openai = await renderIcon(t, "openai");
  assert.notEqual(azure.innerHTML, openai.innerHTML);
});

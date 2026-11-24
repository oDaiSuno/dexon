import assert from "node:assert/strict";
import { remoteProjectSelectors as selectors } from "./remote-projects-page.mjs";

async function verifyDisabledReason(driver, target, expected, name) {
  await driver.waitFor(() => driver.read("exists", target), `the visible disabled ${name} affordance`);
  const control = (await driver.read("all", target))[0];
  assert.ok(control.disabled, `${name} exposes aria-disabled to assistive technology`);
  assert.ok(control.describedBy, `${name} has an accessible reason`);
  assert.ok(control.style.border.includes("dashed"), `${name} uses the dashed unavailable treatment`);
  await driver.hover(target);
  const tooltip = {
    selector: control.describedBy
      .split(/\s+/u)
      .map((id) => `[role="tooltip"][id=${JSON.stringify(id)}]`)
      .join(","),
  };
  await driver.waitFor(
    async () => expected.test(await driver.read("text", tooltip)),
    `${name} explains its remote restriction on hover`,
  );
  const hoverText = await driver.read("text", tooltip);
  const hoverScreenshot = await driver.screenshot(`${name}-reason-hover`);
  await driver.hover({ selector: `${selectors.panel} button`, text: "Explorer" });
  await driver.focusCss(target);
  await driver.waitFor(
    async () => expected.test(await driver.read("text", tooltip)),
    `${name} explains the same restriction on native keyboard focus`,
  );
  assert.equal(await driver.read("text", tooltip), hoverText);
  const focusScreenshot = await driver.screenshot(`${name}-reason-keyboard`);
  await driver.key("Escape");
  await driver.waitFor(async () => !(await driver.read("exists", tooltip)), `${name} tooltip dismisses with Escape`);
  return { control, hoverText, nativeKeyboardFocus: true, screenshots: [hoverScreenshot, focusScreenshot] };
}

export async function verifyRemoteAffordances({ driver, views }) {
  await driver.showPanel();
  await driver.click({ role: "button", name: "Explorer" });
  const browserControls = await driver.read("all", { selector: `${selectors.panel} button`, text: "Local preview" });
  assert.equal(browserControls.length, 1, "Remote port-forwarding environments expose the embedded browser preview");
  assert.equal(browserControls[0].disabled, false, "Local preview is enabled when remote port forwarding is supported");
  const finderTarget = {
    selector: `${selectors.panel} button[aria-disabled="true"]`,
    includes: process.platform === "darwin" ? "Finder" : "file manager",
  };
  const finder = await verifyDisabledReason(
    driver,
    finderTarget,
    /remote.*(?:local file manager|Finder)/iu,
    "remote-finder",
  );
  assert.ok(finder.hoverText.includes(views.alpha.label), "The Finder reason names the actual server");
  assert.match(finder.hoverText, /copy.*remote path|view.*file panel/iu);
  return {
    browser: { enabled: true },
    finder,
    browserEnabledWithPortForwarding: true,
    limitation:
      "Finder evidence covers the visible dashed disabled control and its hover/keyboard reasons. No native file-manager window is launched.",
  };
}

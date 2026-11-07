import assert from "node:assert/strict";

function lifecycleScrolling(name) {
  const { document, getComputedStyle, innerWidth, innerHeight } = globalThis;
  const control = [...document.querySelectorAll('[role="switch"]')].find((element) =>
    [...element.labels].some((label) => label.textContent.trim() === name),
  );
  let scroller = control?.parentElement;
  while (scroller && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  if (!scroller || !control) return null;
  const bounds = scroller.getBoundingClientRect();
  const target = control.getBoundingClientRect();
  return {
    scrollTop: scroller.scrollTop,
    scrollRange: scroller.scrollHeight - scroller.clientHeight,
    point: { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) },
    target: { top: target.top, bottom: target.bottom },
    viewport: { width: innerWidth, height: innerHeight },
  };
}

export async function verifyRemoteSettingsMinimumWindow({
  window,
  driver,
  labels,
  pickerScope,
  openPicker,
  browseColumns,
  unchanged,
}) {
  const observations = [];
  const scrolling = () => driver.js(`(${lifecycleScrolling.toString()})(${JSON.stringify(labels.detached)})`);
  window.setContentSize(900, 600);
  try {
    for (const theme of ["light", "dark"]) {
      await driver.theme(theme);
      const before = await scrolling();
      assert.ok(before && before.scrollRange > 0, "minimum-size settings exposes a user-scrollable content pane");
      window.focus();
      window.webContents.focus();
      for (let attempt = 0; attempt < 80; attempt++) {
        if ((await driver.page("focus")).name === labels.detached) break;
        if (attempt === 79) throw new Error("Native Tab could not reach the lifecycle switch");
        await driver.key("Tab");
      }
      await driver.waitFor(async () => {
        const current = await scrolling();
        return current.scrollTop > 0 && current.target.top >= 0 && current.target.bottom <= current.viewport.height;
      }, "keyboard navigation scrolls the lifecycle switches into the minimum window");
      const policy = await scrolling();
      const screenshots = [await driver.screenshot(`servers-minimum-${theme}`)];
      await openPicker();
      const columns = await browseColumns();
      for (const column of columns) {
        assert.ok(column.rect.x >= 0 && column.rect.right <= 900, "both folder columns fit the real minimum width");
      }
      const confirm = (await driver.page("elements", { role: "button", name: labels.confirm, scope: pickerScope }))[0];
      assert.ok(confirm.rect.y >= 0 && confirm.rect.bottom <= 600, "confirmation stays visible in the minimum window");
      screenshots.push(await driver.screenshot(`picker-minimum-${theme}`));
      await driver.click({ role: "button", name: "Cancel", scope: pickerScope });
      await unchanged("Minimum-window browsing and cancellation preserve workspace focus");
      observations.push({
        theme,
        viewport: window.getContentSize(),
        nativeKeyboardScrolling: true,
        policy,
        columns,
        screenshots,
      });
    }
  } finally {
    window.setContentSize(1280, 900);
  }
  return observations;
}

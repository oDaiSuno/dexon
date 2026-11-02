import assert from "node:assert/strict";

function assertReachable(state) {
  assert.equal(state.settings.reachable, true, `Settings stays reachable with 30 roots: ${JSON.stringify(state)}`);
  assert.equal(state.cap.reachable, true, "Show fewer stays reachable outside the scrolling tasks");
  assert.equal(state.cap.height, 24);
  assert.equal(state.header.height, 22);
  assert.ok(state.well.bottom <= state.settings.y, "expanded tasks cannot push over the footer");
  assert.ok(state.history.height >= 28, "History retains space for a real session row");
  assert.equal(state.rootNames.length, 30);
  assert.ok(state.rowHeights.every((height) => height === 28));
  assert.ok(
    state.viewport.scrollHeight > state.viewport.clientHeight,
    "all 30 tasks remain laid out in a bounded scroller",
  );
  assert.match(state.viewport.overflowY, /auto|scroll/);
  assert.ok(
    state.viewport.scrollWidth <= state.viewport.clientWidth + 1,
    "the task scroller needs no horizontal navigation",
  );
}

export async function verifyManyRoots({ js, click, waitFor, capture, wheel, resize, assertWellRows }) {
  await click("navigation", "button", "Show sidebar");
  await js("window.pulseProof.manyRoots()");
  await waitFor(
    "window.pulseProof.overflowState().rootNames.length === 3 && window.pulseProof.overflowState().activeCount === 30",
  );
  const folded = await js("window.pulseProof.overflowState()");
  assert.equal(folded.cap.height, 24);
  await click("well", "button", "Show all active tasks");
  await waitFor("window.pulseProof.overflowState().rootNames.length === 30");
  const top = await js("window.pulseProof.overflowState()");
  assertReachable(top);
  assertWellRows(await js("window.pulseProof.measurements()"));
  await capture("many-roots-top", top);

  async function visitEveryRoot() {
    let state = await js("window.pulseProof.overflowState()");
    if (state.viewport.scrollTop > 0) {
      const before = state.viewport.scrollTop;
      const at = { x: state.viewport.x + state.viewport.width / 2, y: state.viewport.y + state.viewport.height / 2 };
      await wheel(at, state.viewport.scrollHeight);
      if ((await js("window.pulseProof.overflowState().viewport.scrollTop")) >= before)
        await wheel(at, -state.viewport.scrollHeight);
      await waitFor("window.pulseProof.overflowState().viewport.scrollTop === 0");
      state = await js("window.pulseProof.overflowState()");
    }
    const seen = new Set(state.visibleRoots);
    let direction = -1;
    const visits = [{ scrollTop: state.viewport.scrollTop, roots: state.visibleRoots }];
    for (let step = 0; step < 40 && seen.size < 30; step++) {
      const before = state.viewport.scrollTop;
      if (before >= state.viewport.scrollHeight - state.viewport.clientHeight) break;
      const delta = Math.max(28, Math.floor(state.viewport.clientHeight / 2));
      await wheel(
        { x: state.viewport.x + state.viewport.width / 2, y: state.viewport.y + state.viewport.height / 2 },
        direction * delta,
      );
      state = await js("window.pulseProof.overflowState()");
      if (step === 0 && state.viewport.scrollTop <= before) {
        direction = 1;
        await wheel(
          { x: state.viewport.x + state.viewport.width / 2, y: state.viewport.y + state.viewport.height / 2 },
          delta,
        );
      }
      await waitFor(`window.pulseProof.overflowState().viewport.scrollTop > ${before}`);
      state = await js("window.pulseProof.overflowState()");
      assertReachable(state);
      state.visibleRoots.forEach((name) => seen.add(name));
      visits.push({ scrollTop: state.viewport.scrollTop, roots: state.visibleRoots });
    }
    assert.equal(
      seen.size,
      30,
      `native wheel scrolling reaches every active root, not only the first screen: ${JSON.stringify(visits)}`,
    );
    assertWellRows(await js("window.pulseProof.measurements()"));
    const last = state.rootNames.at(-1);
    assert.ok(state.visibleRoots.includes(last), "the last root is not hidden behind the cap");
    await click("well", "button", last);
    await waitFor(`window.pulseProof.overflowState().selectedRoots.includes(${JSON.stringify(last)})`);
    return { ...(await js("window.pulseProof.overflowState()")), visitedRoots: [...seen], visits };
  }

  const bottom = await visitEveryRoot();
  assert.equal(bottom.cap.y, top.cap.y, "the cap stays fixed while the task rows scroll");
  await capture("many-roots-bottom", bottom);
  await click("navigation", "button", "Settings");
  await waitFor("window.pulseProof.overflowState().settingsOpen");
  await capture("many-roots-settings", await js("window.pulseProof.overflowState()"));
  await click("settings", "button", "Back to session");
  await click("well", "button", "Show fewer active tasks");
  const fewer = await js("window.pulseProof.overflowState()");
  assert.equal(fewer.rootNames.length, 3);
  assert.equal(fewer.well.height, folded.well.height, "normal three-row geometry is unchanged after showing fewer");
  assert.equal(fewer.cap.height, 24);
  assert.ok(fewer.rowHeights.every((height) => height === 28));
  assert.equal(fewer.settings.reachable, true);
  await capture("many-roots-fewer", fewer);

  await resize(1280, 600);
  await waitFor("window.pulseProof.overflowState().frameHeight < 600");
  await click("well", "button", "Show all active tasks");
  await capture("many-roots-compact", await visitEveryRoot());
  const normal = [];
  for (const [count, height] of [
    [1, 63],
    [2, 92],
    [3, 121],
  ]) {
    await js(`window.pulseProof.manyRoots(${count})`);
    await waitFor(
      `window.pulseProof.overflowState().activeCount === ${count} && window.pulseProof.overflowState().rootNames.length === ${count}`,
    );
    const state = await js("window.pulseProof.overflowState()");
    assert.equal(state.well.height, height, `${count} root tasks retain their signed natural height`);
    assert.equal(state.header.height, 22);
    assert.ok(state.rowHeights.every((rowHeight) => rowHeight === 28));
    assert.equal(state.cap, null);
    assert.equal(state.visibleRoots.length, count);
    assert.ok(state.viewport.scrollHeight <= state.viewport.clientHeight);
    assert.equal(state.settings.reachable, true);
    normal.push(state);
  }
  await capture("normal-row-geometry", { cases: normal });
}

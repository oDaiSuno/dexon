import assert from "node:assert/strict";
import { FOLD_THRESHOLD_LINES, FOLDED_LINES } from "../fixtures/long-prompt.mjs";

export const ZH = "zh-CN";
export const EN = "en-US";
export const VIEWPORT = { width: 1440, height: 900 };
export const NARROW_WIDTH = 360;

const FOLLOW_TOLERANCE_PX = 40;

export const quote = (value) => JSON.stringify(value);
export const exactText = (value) => value.replace(/\r\n/g, "\n");

export function parseColor(value) {
  const match = /rgba?\(([^)]+)\)/.exec(value ?? "");
  if (!match) return null;
  const parts = match[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

export function createFoldChecks({ page, waitFor, paint, sleep, near }) {
  const fold = (marker) => page(`fold(${quote(marker)})`);

  const foldPoint = async (marker) => {
    const point = await page(`foldPoint(${quote(marker)})`);
    assert.ok(point, `the long prompt ${marker} shows a fold control`);
    return point;
  };

  const conversation = () => page("conversation()");
  const foldedHeight = (snapshot) => FOLDED_LINES * snapshot.region.lineHeight;
  const isFolded = (snapshot) =>
    Boolean(snapshot.region && snapshot.bar) && Math.abs(snapshot.region.clientHeight - foldedHeight(snapshot)) <= 2;
  const isOpen = (snapshot) =>
    Boolean(snapshot.region && snapshot.bar) && snapshot.region.clientHeight >= snapshot.region.scrollHeight - 2;

  const follows = async (label, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    let state = await conversation();
    while (Date.now() < deadline) {
      if (Math.abs(state.distanceToLiveEnd) <= FOLLOW_TOLERANCE_PX) return state;
      await sleep(80);
      state = await conversation();
    }
    throw new Error(`${label}: the view sits ${state?.distanceToLiveEnd}px away from the newest content`);
  };

  async function waitUntil(marker, predicate, label, timeout = 10000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const snapshot = await fold(marker);
      if (predicate(snapshot)) return snapshot;
      if (Date.now() > deadline) {
        const actual = snapshot?.region
          ? {
              height: Math.round(snapshot.region.rect.height),
              text: snapshot.region.scrollHeight,
              lines: snapshot.region.lines,
              folded: Boolean(snapshot.bar),
              expanded: snapshot.bar?.buttons?.[0]?.expanded ?? null,
            }
          : null;
        throw new Error(`${label} (still ${JSON.stringify(actual)})`);
      }
      await sleep(40);
    }
  }

  async function show(marker, options = {}) {
    const { scroll = true, ...settings } = options;
    await page(`configure(${quote({ language: ZH, theme: "light", ...settings })})`);
    await waitFor("!document.body.textContent.includes('Loading session...')", "the session to load");
    await waitFor(`!!window.userBubble.fold(${quote(marker)}).exists`, `the prompt ${marker}`);
    if (scroll) {
      await page(`scrollTo(${quote(marker)})`);
      await paint();
    }
    return fold(marker);
  }

  function assertFolded(snapshot, label) {
    assert.ok(snapshot.region, `${label}: the prompt has text to fold`);
    assert.ok(snapshot.bar, `${label}: the prompt shows a fold bar`);
    assert.equal(snapshot.bar.buttons.length, 1, `${label}: the fold bar holds exactly one toggle`);
    assert.equal(snapshot.bar.buttons[0].expanded, "false", `${label}: the toggle reports the collapsed state`);
    assert.ok(
      snapshot.region.lines > FOLD_THRESHOLD_LINES,
      `${label}: the text is longer than ${FOLD_THRESHOLD_LINES} rendered lines (${snapshot.region.lines})`,
    );
    near(snapshot.region.clientHeight, foldedHeight(snapshot), `${label}: ${FOLDED_LINES} lines stay visible`, 2);
    assert.ok(
      snapshot.region.scrollHeight > foldedHeight(snapshot) * 2,
      `${label}: the whole text stays laid out (${snapshot.region.scrollHeight}px)`,
    );
  }

  return { fold, foldPoint, conversation, foldedHeight, isFolded, isOpen, follows, waitUntil, show, assertFolded };
}

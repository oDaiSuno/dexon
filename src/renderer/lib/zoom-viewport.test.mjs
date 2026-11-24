import assert from "node:assert/strict";
import test from "node:test";
import { createViewport, inspectViewport, transitionViewport } from "./zoom-viewport.ts";

const apply = (v, ...actions) => actions.reduce(transitionViewport, v);
const ready = (width = 1000, height = 500, vw = 532, vh = 532) =>
  apply(createViewport(), { type: "measure", width: vw, height: vh }, { type: "content-ready", width, height });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const geometry = (v, scale, x, y) => {
  const p = inspectViewport(v);
  assert.equal(p.phase, "ready");
  close(p.scale, scale);
  close(p.translate.x, x);
  close(p.translate.y, y);
  return p;
};
const at = (x, y) => ({ x, y });
const toggle = (v, x = 266, y = 266) => transitionViewport(v, { type: "toggle-actual", at: at(x, y) });
const pan = (v, x, y) =>
  apply(
    v,
    { type: "pan-start", pointerId: 1, at: at(0, 0) },
    { type: "pan-move", pointerId: 1, at: at(x, y) },
    { type: "pan-end", pointerId: 1 },
  );

test("fit uses a sixteen pixel inset and centers the image", () => {
  geometry(ready(), 0.5, 16, 141);
});

test("zoom preserves the content point beneath the pointer", () => {
  const p = geometry(
    transitionViewport(ready(), { type: "zoom", at: at(141, 266), logDelta: Math.log(2) }),
    1,
    -109,
    16,
  );
  close(p.translate.x + 250 * p.scale, 141);
  close(p.translate.y + 250 * p.scale, 266);
});

test("edges take precedence over anchoring and dragging cannot reveal blank space", () => {
  const v = toggle(ready(1000, 1000), 16, 16);
  geometry(v, 1, 0, 0);
  geometry(pan(v, -10000, -10000), 1, -468, -468);
});

test("small images stay centered and cannot start a drag", () => {
  const v = ready(100, 50);
  assert.equal(geometry(v, 1, 216, 241).canPan, false);
  assert.equal(transitionViewport(v, { type: "pan-start", pointerId: 1, at: at(0, 0) }), v);
});

test("double clicking a small image toggles two hundred percent and fit", () => {
  const v = toggle(ready(100, 50), 300, 300);
  geometry(v, 2, 166, 216);
  assert.equal(geometry(toggle(v), 1, 216, 241).mode, "fit");
});

test("steps hit actual size and fit exactly and stop at the minimum", () => {
  let v = ready(1600, 900, 360, 600);
  const step = (direction) => {
    v = transitionViewport(v, { type: "step", direction });
    return inspectViewport(v);
  };
  close(inspectViewport(v).scale, 0.205);
  for (const scale of [0.25, 0.5, 0.75, 1]) close(step(1).scale, scale);
  for (const scale of [0.75, 0.5, 0.25]) close(step(-1).scale, scale);
  assert.equal(step(-1).mode, "fit");
  close(step(-1).scale, 0.1);
  close(step(-1).scale, 0.05);
  assert.equal(inspectViewport(v).canZoomOut, false);
  assert.equal(transitionViewport(v, { type: "step", direction: -1 }), v);
});

test("zoom at the maximum returns the exact same viewport", () => {
  let v = ready();
  for (let i = 0; i < 4; i++) v = transitionViewport(v, { type: "zoom", at: at(266, 266), logDelta: 100 });
  close(inspectViewport(v).scale, 16);
  assert.equal(transitionViewport(v, { type: "zoom", at: at(266, 266), logDelta: 1 }), v);
  const almost = transitionViewport(v, { type: "zoom", at: at(266, 266), logDelta: Math.log(15.99 / 16) });
  close(inspectViewport(transitionViewport(almost, { type: "step", direction: 1 })).scale, 16);
});

test("panoramas may fit below five percent", () => {
  geometry(ready(20000, 1000, 280, 500), 0.0124, 16, 243.8);
});

test("zero sized containers suspend without changing the view", () => {
  const v = pan(toggle(ready(1000, 1000)), -50, -60);
  const suspended = transitionViewport(v, { type: "measure", width: 0, height: 532 });
  assert.equal(inspectViewport(suspended).phase, "unavailable");
  assert.deepEqual(
    inspectViewport(transitionViewport(suspended, { type: "measure", width: 532, height: 532 })),
    inspectViewport(v),
  );
});

test("temporary container clamping does not consume the intended focus", () => {
  const v = pan(toggle(ready(1000, 1000)), 134, 134);
  geometry(v, 1, -100, -100);
  const enlarged = transitionViewport(v, { type: "measure", width: 1200, height: 1200 });
  geometry(enlarged, 1, 100, 100);
  geometry(transitionViewport(enlarged, { type: "measure", width: 532, height: 532 }), 1, -100, -100);
  const clamped = transitionViewport(v, { type: "measure", width: 800, height: 800 });
  const edgeDrag = pan(clamped, 10, 10);
  geometry(transitionViewport(edgeDrag, { type: "measure", width: 532, height: 532 }), 1, -100, -100);
});

test("pending content preserves intent and ignores interaction until ready", () => {
  const v = pan(toggle(ready()), -30, 0);
  const pending = transitionViewport(v, { type: "content-pending" });
  assert.equal(transitionViewport(pending, { type: "zoom", at: at(100, 100), logDelta: 1 }), pending);
  assert.equal(pan(pending, -100, -100), pending);
  assert.deepEqual(
    inspectViewport(transitionViewport(pending, { type: "content-ready", width: 1000, height: 500 })),
    inspectViewport(v),
  );
});

test("same aspect higher resolution content preserves the visible framing", () => {
  const v = toggle(ready(), 16, 266);
  geometry(v, 1, 0, 16);
  geometry(transitionViewport(v, { type: "content-ready", width: 2000, height: 1000 }), 0.5, 0, 16);
});

test("large aspect changes reset to fit", () => {
  const p = geometry(
    transitionViewport(toggle(ready()), { type: "content-ready", width: 500, height: 1000 }),
    0.5,
    141,
    16,
  );
  assert.equal(p.mode, "fit");
});

test("a pointer reverses immediately after hitting an edge", () => {
  const v = apply(
    toggle(ready(1000, 1000), 16, 16),
    { type: "pan-start", pointerId: 1, at: at(100, 100) },
    { type: "pan-move", pointerId: 1, at: at(300, 100) },
  );
  geometry(v, 1, 0, 0);
  geometry(transitionViewport(v, { type: "pan-move", pointerId: 1, at: at(299, 100) }), 1, -1, 0);
});

test("a second pointer cannot move or end a drag and cancellation is idempotent", () => {
  const v = transitionViewport(toggle(ready()), { type: "pan-start", pointerId: 1, at: at(100, 100) });
  for (const action of [
    { type: "pan-start", pointerId: 2, at: at(0, 0) },
    { type: "pan-move", pointerId: 2, at: at(0, 0) },
    { type: "pan-end", pointerId: 2 },
  ])
    assert.equal(transitionViewport(v, action), v);
  const ended = transitionViewport(v, { type: "cancel" });
  assert.equal(inspectViewport(ended).dragging, false);
  assert.equal(transitionViewport(ended, { type: "cancel" }), ended);
});

test("invalid input never creates a nonfinite projection and repeated inputs are noops", () => {
  const v = ready();
  assert.equal(transitionViewport(v, { type: "measure", width: 532, height: 532 }), v);
  assert.equal(transitionViewport(v, { type: "content-ready", width: 1000, height: 500 }), v);
  assert.equal(transitionViewport(v, { type: "fit" }), v);
  for (const n of [0, -1, NaN, Infinity]) {
    for (const type of ["measure", "content-ready"]) {
      for (const [width, height] of [
        [n, 500],
        [500, n],
      ])
        assert.equal(inspectViewport(transitionViewport(v, { type, width, height })).phase, "unavailable");
    }
  }
  for (const n of [NaN, Infinity, -Infinity]) {
    for (const action of [
      { type: "zoom", at: at(n, 1), logDelta: 1 },
      { type: "zoom", at: at(1, n), logDelta: 1 },
      { type: "zoom", at: at(1, 1), logDelta: n },
      { type: "toggle-actual", at: at(n, 1) },
      { type: "pan-start", pointerId: 1, at: at(1, n) },
    ])
      assert.equal(transitionViewport(v, action), v);
  }
  assert.equal(transitionViewport(v, { type: "zoom", at: at(1, 1), logDelta: 0 }), v);
  geometry(v, 0.5, 16, 141);
});

test("bookmarks restore framing and rebase when resolution changes", () => {
  const v = pan(toggle(ready()), -20, 0);
  const bookmark = inspectViewport(v).bookmark;
  const restore = (width, height) =>
    apply(
      createViewport(bookmark),
      { type: "measure", width: 532, height: 532 },
      { type: "content-ready", width, height },
    );
  assert.deepEqual(inspectViewport(restore(1000, 500)), inspectViewport(v));
  const p = inspectViewport(restore(2000, 1000));
  close(p.scale, 0.5);
  close(p.translate.x, -254);
  close(p.translate.y, 16);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

// Phase 4 motion contract: the new navigation ships its reduced-motion
// fallback in a dedicated style partial. Every moving part inside the app
// navigation (and the resource page hosted in it) must degrade under
// prefers-reduced-motion, and the partial carries no raw palette values —
// colors always come from the token system (DESIGN.md §2/§6).

const navCssPath = new URL("../../styles/nav.css", import.meta.url);

test("styles/nav.css exists and degrades app-nav motion under reduced motion", () => {
  assert.ok(existsSync(navCssPath), "styles/nav.css must exist for the app navigation");
  const css = readFileSync(navCssPath, "utf8");

  const reducedBlock = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}/);
  assert.ok(reducedBlock, "nav.css must contain a prefers-reduced-motion block");
  assert.match(reducedBlock[1], /\.app-nav\b/, "the reduced-motion fallback must scope the app navigation");
  assert.match(
    reducedBlock[1],
    /\.app-nav-resource\b/,
    "the reduced-motion fallback must scope the resource page hosted by the nav",
  );
  assert.match(
    reducedBlock[1],
    /transition[^;]*0(\.0)?0?1ms|animation[^;]*0(\.0)?0?1ms|transition[^;]*none|animation[^;]*none/,
    "the fallback must zero out transition/animation timing",
  );
});

test("nav.css stays a motion-only partial without palette or typography values", () => {
  const css = readFileSync(navCssPath, "utf8");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "nav.css must not introduce raw hex colors");
  assert.doesNotMatch(css, /font-size/, "nav.css must not introduce typography values");
  assert.doesNotMatch(css, /@keyframes/, "nav.css must reuse the system keyframes, not add new ones");
});

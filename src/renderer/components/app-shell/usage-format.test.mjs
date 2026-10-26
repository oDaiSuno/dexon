import assert from "node:assert/strict";
import test from "node:test";
import { allocateGridCells } from "./usage-format.ts";

test("the context grid gives each kind a share of the 100 cells that always adds up to 100", () => {
  const cells = allocateGridCells([3100, 11800, 6400, 38200, 64500, 59600, 16400], 200_000, 100);
  assert.deepEqual(cells, [2, 6, 3, 19, 32, 30, 8]);
});

test("the context grid never draws more cells than it has when the parts overflow the window", () => {
  assert.deepEqual(allocateGridCells([150, 0, 0, 0, 0, 0, 100], 200, 10), [6, 0, 0, 0, 0, 0, 4]);
});

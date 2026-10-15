import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserObservers } from "../support/browser-observers.mjs";

test("browser resize notifications reach only observers of that target and stop after release", () => {
  const browser = createBrowserObservers();
  const first = {};
  const second = {};
  const received = [];
  const observer = new browser.ResizeObserver((entries) => received.push(entries.map((entry) => entry.target)));
  observer.observe(first);
  browser.resize(second);
  assert.deepEqual(received, []);
  browser.resize(first);
  assert.deepEqual(received, [[first]]);
  observer.disconnect();
  browser.resize(first);
  assert.deepEqual(received, [[first]], "released browser targets receive no later notification");
  assert.equal(browser.resizeTargets().size, 0);
});

test("browser intersections stop for an unobserved target and resume on a new observation", () => {
  const browser = createBrowserObservers();
  const target = {};
  const received = [];
  const observer = new browser.IntersectionObserver((entries) => received.push(entries[0].isIntersecting));
  observer.observe(target);
  browser.intersect(target, true);
  observer.unobserve(target);
  browser.intersect(target, false);
  observer.observe(target);
  browser.intersect(target, false);
  observer.disconnect();
  browser.intersect(target, true);
  assert.deepEqual(received, [true, false]);
  assert.equal(browser.intersectionTargets().size, 0);
});

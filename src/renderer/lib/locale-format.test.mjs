import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCompactNumber,
  formatFileSize,
  formatNumber,
  formatRelativeDateTime,
  formatShortRelativeTime,
} from "./locale-format.ts";

const now = new Date("2026-08-12T12:00:00.000Z");

test("formats relative time with the selected locale and fixed thresholds", () => {
  assert.equal(formatRelativeDateTime("2026-08-12T11:59:45.000Z", "en-US", now), "now");
  assert.equal(formatRelativeDateTime("2026-08-12T11:55:00.000Z", "en-US", now), "5 minutes ago");
  assert.equal(formatRelativeDateTime("2026-08-12T10:00:00.000Z", "zh-CN", now), "2小时前");
  assert.equal(formatRelativeDateTime("2026-08-10T12:00:00.000Z", "zh-CN", now), "前天");
  assert.equal(formatRelativeDateTime("invalid", "en-US", now), "");
});

test("formats sidebar times as a number followed by a unit letter, like 2m, 1h and 5d", () => {
  const noon = new Date(2026, 9, 22, 12, 0, 0);
  assert.equal(formatShortRelativeTime(new Date(2026, 9, 22, 11, 58, 0), "zh-CN", noon), "2m");
  assert.equal(formatShortRelativeTime(new Date(2026, 9, 22, 11, 40, 0), "en-US", noon), "20m");
  assert.equal(formatShortRelativeTime(new Date(2026, 9, 22, 11, 0, 0), "zh-CN", noon), "1h");
  assert.equal(formatShortRelativeTime(new Date(2026, 9, 17, 12, 0, 0), "zh-CN", noon), "5d");
});

test("formats sidebar times for the edges: just now, yesterday, older dates and bad input", () => {
  const noon = new Date(2026, 9, 22, 12, 0, 0);
  assert.equal(formatShortRelativeTime(new Date(2026, 9, 22, 11, 59, 30), "en-US", noon), "now");
  assert.equal(formatShortRelativeTime(new Date(2026, 9, 22, 12, 0, 5), "zh-CN", noon), "现在");
  assert.equal(formatShortRelativeTime(new Date(2026, 9, 21, 9, 0, 0), "zh-CN", noon), "昨天");
  assert.equal(formatShortRelativeTime(new Date(2026, 9, 21, 9, 0, 0), "en-US", noon), "yesterday");
  assert.equal(
    formatShortRelativeTime(new Date(2026, 9, 21, 23, 0, 0), "zh-CN", new Date(2026, 9, 22, 0, 30, 0)),
    "1h",
  );
  assert.equal(formatShortRelativeTime(new Date(2026, 9, 10, 12, 0, 0), "zh-CN", noon), "10月10日");
  assert.equal(formatShortRelativeTime(new Date(2026, 9, 10, 12, 0, 0), "en-US", noon), "Oct 10");
  assert.equal(formatShortRelativeTime(new Date(2025, 2, 3, 12, 0, 0), "en-US", noon), "3/3/2025");
  assert.equal(formatShortRelativeTime("invalid", "en-US", noon), "");
});

test("formats numbers and file sizes with locale-aware separators", () => {
  assert.equal(formatNumber(1234567, "en-US"), "1,234,567");
  assert.equal(formatNumber(1234567, "zh-CN"), "1,234,567");
  assert.equal(formatCompactNumber(1200, "en-US"), "1.2K");
  assert.equal(formatCompactNumber(12000, "zh-CN"), "1.2万");
  assert.equal(formatFileSize(1536, "en-US"), "1.5 KB");
  assert.equal(formatFileSize(1024 * 1024, "zh-CN"), "1 MB");
  assert.equal(formatFileSize(-1, "en-US"), "");
});

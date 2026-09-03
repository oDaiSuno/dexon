import assert from "node:assert/strict";
import test from "node:test";
import {
  findLeadingSkillCommand,
  isValidSkillName,
  parseExpandedSkillMessage,
  skillCommandText,
  splitLeadingSkillCommand,
} from "./skill-commands.ts";

test("findLeadingSkillCommand parses the leading command with greedy name", () => {
  const match = findLeadingSkillCommand("/skill:fast-context 帮我梳理架构");
  assert.deepEqual(match, { name: "fast-context", start: 0, end: 19 });
  assert.equal(skillCommandText(match.name), "/skill:fast-context");
});

test("findLeadingSkillCommand accepts a bare command with no arguments", () => {
  assert.deepEqual(findLeadingSkillCommand("/skill:groksearch"), { name: "groksearch", start: 0, end: 17 });
});

test("findLeadingSkillCommand ignores commands that are not at message start", () => {
  assert.equal(findLeadingSkillCommand("请先 /skill:fast-context 阅读"), null);
  assert.equal(findLeadingSkillCommand("\n/skill:fast-context"), null);
});

test("findLeadingSkillCommand rejects invalid or incomplete names", () => {
  // no name yet
  assert.equal(findLeadingSkillCommand("/skill:"), null);
  // a valid partial name at end-of-text is a real command (see bare-command test)
  // invalid name shapes
  assert.equal(findLeadingSkillCommand("/skill:-bad"), null);
  assert.equal(findLeadingSkillCommand("/skill:bad-"), null);
  assert.equal(findLeadingSkillCommand("/skill:bad--name "), null);
  assert.equal(findLeadingSkillCommand("/skill:Bad_Name "), null);
  assert.equal(findLeadingSkillCommand("/skill:over-64-" + "a".repeat(64)), null);
});

test("findLeadingSkillCommand stops the name at the separator", () => {
  const match = findLeadingSkillCommand("/skill:refactoring-ui 优化按钮");
  assert.deepEqual(match, { name: "refactoring-ui", start: 0, end: 21 });
  assert.equal("/skill:refactoring-ui 优化按钮".slice(match.start, match.end), "/skill:refactoring-ui");
});

test("isValidSkillName enforces pi name rules", () => {
  assert.equal(isValidSkillName("fast-context"), true);
  assert.equal(isValidSkillName("a"), true);
  assert.equal(isValidSkillName(""), false);
  assert.equal(isValidSkillName("-lead"), false);
  assert.equal(isValidSkillName("trail-"), false);
  assert.equal(isValidSkillName("dou--ble"), false);
  assert.equal(isValidSkillName("Upper"), false);
  assert.equal(isValidSkillName("a".repeat(65)), false);
});

test("splitLeadingSkillCommand splits badge from prose and keeps the separator", () => {
  const split = splitLeadingSkillCommand("/skill:fast-context 帮我梳理架构");
  assert.deepEqual(split, { name: "fast-context", rest: " 帮我梳理架构" });
});

test("parseExpandedSkillMessage parses pi's expanded <skill> block", () => {
  const expanded =
    '<skill name="fast-context" location="/home/u/.pi/agent/skills/fast-context/SKILL.md">\nReferences are relative to /home/u/.pi/agent/skills/fast-context.\n\nBody line one.\nBody line two.\n</skill>\n\n帮我梳理架构';
  assert.deepEqual(parseExpandedSkillMessage(expanded), {
    name: "fast-context",
    rest: "帮我梳理架构",
  });
  // no trailing args: rest is empty
  const bare = '<skill name="groksearch" location="/x/SKILL.md">\nrefs\n\nbody\n</skill>';
  assert.deepEqual(parseExpandedSkillMessage(bare), { name: "groksearch", rest: "" });
  // unterminated block stays prose; invalid names stay prose
  assert.equal(parseExpandedSkillMessage('<skill name="fast" location="/x">\nno close'), null);
  assert.equal(parseExpandedSkillMessage('<skill name="-bad" location="/x">\nb\n</skill>\n\nrest'), null);
  assert.equal(parseExpandedSkillMessage('plain message with <skill name="x"> text'), null);
});

test("splitLeadingSkillCommand requires a separator or end of text after the name", () => {
  assert.deepEqual(splitLeadingSkillCommand("/skill:fast-context"), { name: "fast-context", rest: "" });
  // name charset is greedy, so a bare prefix can never be followed by name chars
  assert.equal(splitLeadingSkillCommand("/skill:fast-context:extra"), null);
  assert.equal(splitLeadingSkillCommand("plain message"), null);
});

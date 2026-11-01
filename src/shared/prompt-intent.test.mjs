import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { importTestBundle } from "#test-bundle";

const { promptIntentText, readPromptIntent, titleSourceOf } = await importTestBundle("shared-prompt-intent", {
  entryPoints: [path.join(import.meta.dirname, "prompt-intent.ts")],
});

function expanded(
  name,
  goal = "",
  body = "References are relative to the skill directory.\n\nBody line one.\nBody line two.",
) {
  return `<skill name="${name}" location="/home/u/.pi/agent/skills/${name}/SKILL.md">\n${body}\n</skill>${goal ? `\n\n${goal}` : ""}`;
}

test("typed and expanded skill prompts describe the same user goal", () => {
  const expected = { kind: "skill", name: "fast-context", goal: "帮我梳理架构" };
  assert.deepEqual(readPromptIntent("/skill:fast-context 帮我梳理架构"), expected);
  assert.deepEqual(readPromptIntent(expanded("fast-context", "帮我梳理架构")), expected);
  assert.deepEqual(readPromptIntent("/skill:fast-context \n 帮我梳理架构 \n"), expected);
  assert.deepEqual(readPromptIntent(expanded("fast-context", " \n 帮我梳理架构 \n")), expected);
});

test("bare skills have an empty goal in either transport form", () => {
  const expected = { kind: "skill", name: "groksearch", goal: "" };
  assert.deepEqual(readPromptIntent("/skill:groksearch"), expected);
  assert.deepEqual(readPromptIntent(expanded("groksearch")), expected);
  assert.equal(promptIntentText(expected), "/skill:groksearch");
  assert.equal(titleSourceOf(expected), null);
});

test("ordinary prose stays byte-identical through normalization", () => {
  for (const text of ["帮我梳理架构", " \n keep this spacing \n", "请先 /skill:fast-context 阅读", " /model chosen"]) {
    assert.deepEqual(readPromptIntent(text), { kind: "prose", text });
    assert.equal(promptIntentText(readPromptIntent(text)), text);
  }
});

test("leading non-skill slash commands remain commands", () => {
  for (const text of [
    "/model chosen",
    "/init",
    "/skill:",
    "/skill:-bad",
    "/skill:bad-",
    "/skill:Bad_Name",
    "/skill:fast:extra",
  ]) {
    assert.deepEqual(readPromptIntent(text), { kind: "command", text });
    assert.equal(titleSourceOf(readPromptIntent(text)), null);
  }
});

test("malformed, invalid, and non-leading expanded skill blocks remain prose", () => {
  for (const text of [
    '<skill name="fast" location="/x">\nno close',
    expanded("-bad", "rest"),
    expanded("bad--name", "rest"),
    expanded("a".repeat(65), "rest"),
    'plain message with <skill name="x"> text',
    ` ${expanded("fast-context", "rest")}`,
    `\n${expanded("fast-context", "rest")}`,
    "\n/skill:fast-context goal",
  ]) {
    assert.deepEqual(readPromptIntent(text), { kind: "prose", text });
    assert.equal(promptIntentText(readPromptIntent(text)), text);
  }
});

test("normalization round-trips prose, commands, and canonical skill intents", () => {
  const intents = [
    { kind: "prose", text: "" },
    { kind: "prose", text: "  plain\ntext  " },
    { kind: "command", text: "/model chosen" },
    { kind: "skill", name: "fast-context", goal: "帮我梳理架构" },
    { kind: "skill", name: "groksearch", goal: "" },
    { kind: "skill", name: "a".repeat(64), goal: "valid boundary" },
    { kind: "skill", name: "fast-context", goal: "first\nsecond" },
  ];
  for (const intent of intents) {
    assert.deepEqual(readPromptIntent(promptIntentText(intent)), intent);
  }
});

test("only the leading skill layer is unwrapped", () => {
  const goal = "/skill:groksearch keep this in the goal";
  const expected = { kind: "skill", name: "fast-context", goal };
  assert.deepEqual(readPromptIntent(`/skill:fast-context ${goal}`), expected);
  assert.deepEqual(readPromptIntent(expanded("fast-context", goal)), expected);
  assert.deepEqual(titleSourceOf(expected), { goal, skill: "fast-context" });
});

test("title sources contain the user's goal and only a short skill hint", () => {
  assert.deepEqual(titleSourceOf(readPromptIntent("  修复登录页  ")), { goal: "修复登录页" });
  assert.deepEqual(titleSourceOf(readPromptIntent(expanded("fast-context", "帮我梳理架构", "x".repeat(4000)))), {
    goal: "帮我梳理架构",
    skill: "fast-context",
  });
  assert.equal(
    promptIntentText(readPromptIntent(expanded("fast-context", "帮我梳理架构"))),
    "/skill:fast-context 帮我梳理架构",
  );
});

test("title eligibility counts goal code points after trimming", () => {
  for (const text of [
    "",
    " \n ",
    "好",
    "😂",
    "/skill:fast-context",
    "/skill:fast-context 好",
    "/skill:fast-context 😂",
  ]) {
    assert.equal(titleSourceOf(readPromptIntent(text)), null);
  }
  assert.deepEqual(titleSourceOf(readPromptIntent("😂😂")), { goal: "😂😂" });
  assert.deepEqual(titleSourceOf(readPromptIntent("/skill:fast-context 😂😂")), {
    goal: "😂😂",
    skill: "fast-context",
  });
});

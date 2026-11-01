import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_TITLE_REQUEST_MAX_CHARS,
  planNamingModels,
  sanitizeGeneratedTitle,
  takeCodePoints,
  titlePromptText,
} from "./session-title.ts";

test("sanitizeGeneratedTitle strips wrapping quotes and trailing punctuation", () => {
  assert.equal(sanitizeGeneratedTitle('"Fix the login page"'), "Fix the login page");
  assert.equal(sanitizeGeneratedTitle("修复登录页的样式问题。"), "修复登录页的样式问题");
  assert.equal(sanitizeGeneratedTitle("Debug the build failure!"), "Debug the build failure");
  assert.equal(sanitizeGeneratedTitle("「方案评审」"), "方案评审");
});

test("sanitizeGeneratedTitle collapses newlines and whitespace", () => {
  assert.equal(sanitizeGeneratedTitle("Fix\n the\r\nlogin\n page"), "Fix the login page");
});

test("sanitizeGeneratedTitle caps output at 40 characters", () => {
  const long = "a".repeat(120);
  const result = sanitizeGeneratedTitle(long);
  assert.equal(result.length, 40);
});

test("sanitizeGeneratedTitle returns null for empty or punctuation-only output", () => {
  assert.equal(sanitizeGeneratedTitle(""), null);
  assert.equal(sanitizeGeneratedTitle("   "), null);
  assert.equal(sanitizeGeneratedTitle("...。！"), null);
});

test("sanitizeGeneratedTitle keeps astral characters intact (length by code points)", () => {
  const result = sanitizeGeneratedTitle("😂".repeat(60));
  assert.equal([...result].length, 40);
});

test("takeCodePoints splits by code points, not UTF-16 units", () => {
  assert.equal(takeCodePoints("a😂b", 2), "a😂");
  assert.equal(takeCodePoints("abc", 2), "ab");
  assert.equal(takeCodePoints("abc", 0), "");
});

test("titlePromptText puts the user's goal first and the skill hint last", () => {
  assert.equal(
    titlePromptText({ goal: "帮我梳理架构", skill: "fast-context" }),
    "帮我梳理架构\n\n(Skill: fast-context)",
  );
  assert.equal(titlePromptText({ goal: "Fix the login page" }), "Fix the login page");
});

test("titlePromptText reserves room for the hint within the 2000 code point limit", () => {
  const result = titlePromptText({ goal: "😂".repeat(2100), skill: "fast-context" });
  assert.equal(result, `${"😂".repeat(1977)}\n\n(Skill: fast-context)`);
  assert.equal([...result].length, AUTO_TITLE_REQUEST_MAX_CHARS);
  assert.equal(titlePromptText({ goal: "x".repeat(2100) }), "x".repeat(2000));
});

const preferred = { provider: "preferred", id: "naming-model" };
const conversation = { provider: "conversation", id: "chat-model" };
const ref = (model) => ({ provider: model.provider, modelId: model.id });

test("naming tries the preference before the conversation model and deduplicates exact references", () => {
  assert.deepEqual(
    planNamingModels({
      preference: ref(preferred),
      conversation: ref(conversation),
      reachable: [conversation, preferred],
    }),
    [preferred, conversation],
  );
  assert.deepEqual(
    planNamingModels({ preference: ref(conversation), conversation: ref(conversation), reachable: [conversation] }),
    [conversation],
  );
  const sameId = { provider: "different-provider", id: conversation.id };
  assert.deepEqual(
    planNamingModels({ preference: ref(sameId), conversation: ref(conversation), reachable: [conversation, sameId] }),
    [sameId, conversation],
  );
});

test("a stale or unreachable preference does not replace the conversation model", () => {
  assert.deepEqual(
    planNamingModels({ preference: ref(preferred), conversation: ref(conversation), reachable: [conversation] }),
    [conversation],
  );
});

test("an unset naming preference uses the conversation model", () => {
  assert.deepEqual(
    planNamingModels({ preference: null, conversation: ref(conversation), reachable: [preferred, conversation] }),
    [conversation],
  );
});

test("naming never falls back to an arbitrary reachable model", () => {
  assert.deepEqual(planNamingModels({ preference: null, conversation: null, reachable: [preferred] }), []);
  assert.deepEqual(
    planNamingModels({ preference: ref(conversation), conversation: ref(conversation), reachable: [preferred] }),
    [],
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildQuestionnaireResult, parseQuestionAnswers, readQuestionnaire } from "./questionnaire.ts";
const q = {
  question: "Which?",
  header: "Choice",
  options: [
    { label: "One", description: "First", preview: "Full\ncode" },
    { label: "Two", description: "Second" },
  ],
  multiSelect: true,
};

test("questionnaire multi choices and raw text survive the model envelope", () => {
  const questions = [q];
  const text = "  note\nline  ";
  const drafts = parseQuestionAnswers(questions, [{ selected: [1, 0], text }]);
  const result = buildQuestionnaireResult(questions, drafts);
  assert.deepEqual(result.details.answers[0].selected, ["One", "Two"]);
  assert.equal(result.details.answers[0].notes, text);
  assert.ok(result.content[0].text.includes(text));
});

test("unanswered questions are explicit and never guessed", () => {
  const questions = [q, { ...q, question: "Unanswered?" }];
  const drafts = parseQuestionAnswers(questions, [
    { selected: [], text: "custom answer" },
    { selected: [], text: "" },
  ]);
  const result = buildQuestionnaireResult(questions, drafts);
  assert.deepEqual(result.details.unanswered, [{ questionIndex: 1, question: "Unanswered?" }]);
  assert.match(result.content[0].text, /Unanswered questions \(do not infer answers\)/);
  assert.equal(result.details.answers[0].answer, "custom answer");
});

test("single choice echoes the full preview and preserves original result fields", () => {
  const result = buildQuestionnaireResult([{ ...q, multiSelect: false }], [{ selected: [0], text: "" }]);
  assert.equal(result.details.answers[0].kind, "option");
  assert.equal(result.details.answers[0].preview, "Full\ncode");
  assert.match(result.content[0].text, /selected preview: Full\ncode/);
});

test("empty submissions, invalid indices, and conflicting single answers are rejected before settlement", () => {
  for (const answer of [
    { selected: [], text: "" },
    { selected: [2], text: "" },
    { selected: [0, 0], text: "" },
    { selected: [0], text: "custom" },
  ]) {
    assert.throws(() => parseQuestionAnswers([{ ...q, multiSelect: false }], [answer]));
  }
});

test("abandonment returns the canonical decline without draft answers", () => {
  const result = buildQuestionnaireResult([q], undefined);
  assert.equal(result.content[0].text, "User declined to answer questions");
  assert.deepEqual(result.details.answers, []);
  assert.equal(result.details.cancelled, true);
});

test("structured adaptation accepts only supported schema and original semantic guards", () => {
  assert.deepEqual(readQuestionnaire({ questions: [q] }), [q]);
  assert.equal(readQuestionnaire({ questions: [q, q] }), null);
  assert.equal(
    readQuestionnaire({ questions: [{ ...q, options: [{ label: "Other", description: "reserved" }, q.options[1]] }] }),
    null,
  );
  assert.equal(readQuestionnaire({ questions: [{ ...q, options: [] }] }), null);
});

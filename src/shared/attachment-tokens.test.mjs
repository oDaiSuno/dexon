import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentTokenName,
  attachmentTokenText,
  segmentByAttachmentTokens,
  backspaceAtTokenEnd,
  findAttachmentTokens,
  insertAttachmentToken,
  isImagePath,
  looksLikePath,
  removeAttachmentToken,
} from "./attachment-tokens.ts";

test("findAttachmentTokens parses unquoted, quoted and mixed tokens in order", () => {
  const value = 'check @src/app.ts and @"my dir/notes v2.md" please';
  const tokens = findAttachmentTokens(value);
  assert.equal(tokens.length, 2);
  assert.deepEqual(
    { path: tokens[0].path, quoted: tokens[0].quoted, start: tokens[0].start, end: tokens[0].end },
    { path: "src/app.ts", quoted: false, start: 6, end: 17 },
  );
  assert.deepEqual(
    { path: tokens[1].path, quoted: tokens[1].quoted, start: tokens[1].start, end: tokens[1].end },
    { path: "my dir/notes v2.md", quoted: true, start: 22, end: 43 },
  );
  assert.equal(value.slice(tokens[0].start, tokens[0].end), "@src/app.ts");
  assert.equal(value.slice(tokens[1].start, tokens[1].end), '@"my dir/notes v2.md"');
});

test("findAttachmentTokens ignores prose mentions and emails", () => {
  assert.deepEqual(findAttachmentTokens("ping @alice about hi@there.com now"), []);
  assert.deepEqual(findAttachmentTokens("see @notes.txt file"), [
    { start: 4, end: 14, path: "notes.txt", quoted: false },
  ]);
});

test("insertAttachmentToken appends a trailing space and quotes spacey paths", () => {
  const plain = insertAttachmentToken("look at ", 8, "/tmp/pi-clipboard-x.png");
  assert.equal(plain.value, "look at @/tmp/pi-clipboard-x.png ");
  assert.equal(plain.caret, plain.value.length);

  const quoted = insertAttachmentToken("", null, "/tmp/my shot.png");
  assert.equal(quoted.value, '@"/tmp/my shot.png" ');
  assert.equal(quoted.caret, quoted.value.length);

  const atEnd = insertAttachmentToken("hello", null, "src/a.ts");
  assert.equal(atEnd.value, "hello @src/a.ts ");
});

test("removeAttachmentToken deletes the token and one trailing space", () => {
  const value = "a @/tmp/x.png b";
  const removed = removeAttachmentToken(value, findAttachmentTokens(value)[0]);
  assert.equal(removed.value, "a b");
  assert.equal(removed.caret, 2);

  const noTrailingSpace = removeAttachmentToken("a @/tmp/x.png", findAttachmentTokens("a @/tmp/x.png")[0]);
  assert.equal(noTrailingSpace.value, "a ");
  assert.equal(noTrailingSpace.caret, 2);
});

test("backspaceAtTokenEnd deletes the whole token when the caret sits at its end", () => {
  const value = "fix @/tmp/a.png now";
  const token = findAttachmentTokens(value)[0];
  // Caret right after the trailing separator space.
  const caretAfterSpace = token.end + 1;
  assert.deepEqual(backspaceAtTokenEnd(value, caretAfterSpace, findAttachmentTokens(value)), {
    value: "fix now",
    caret: 4,
  });
  // Caret directly after the token text itself (no separator space consumed).
  assert.deepEqual(backspaceAtTokenEnd(value, token.end, findAttachmentTokens(value)), {
    value: "fix now",
    caret: 4,
  });
  // Caret elsewhere: no token deletion, default backspace applies.
  assert.equal(backspaceAtTokenEnd(value, 2, findAttachmentTokens(value)), null);
});

test("looksLikePath and isImagePath gate chip rendering", () => {
  assert.equal(looksLikePath("src/app.ts"), true);
  assert.equal(looksLikePath("README.md"), true);
  assert.equal(looksLikePath("~/.zshrc"), true);
  assert.equal(looksLikePath("alice"), false);
  assert.equal(isImagePath("/tmp/pi-clipboard-x.png"), true);
  assert.equal(isImagePath("/tmp/notes.md"), false);
});

test("attachmentTokenName reduces staged paths to their basename", () => {
  assert.equal(attachmentTokenName("/var/folders/x/pi-clipboard-abc.png"), "pi-clipboard-abc.png");
  assert.equal(attachmentTokenName("src/lib/"), "lib");
  assert.equal(attachmentTokenName("file.txt"), "file.txt");
});

test("segmentByAttachmentTokens splits mixed prose into text and token segments", () => {
  const value = 'check @src/app.ts and @"my dir/notes v2.md" please';
  const segments = segmentByAttachmentTokens(value);
  assert.equal(segments.length, 5);
  assert.deepEqual(segments[0], { type: "text", text: "check " });
  assert.deepEqual(segments[1], { type: "token", token: { start: 6, end: 17, path: "src/app.ts", quoted: false } });
  assert.deepEqual(segments[2], { type: "text", text: " and " });
  assert.equal(segments[3].type, "token");
  assert.deepEqual(segments[4], { type: "text", text: " please" });
  const plain = segmentByAttachmentTokens("no references here");
  assert.deepEqual(plain, [{ type: "text", text: "no references here" }]);
});

test("attachmentTokenText round-trips through findAttachmentTokens", () => {
  for (const path of ["/tmp/pi-clipboard-a.png", "/tmp/my shot.png", "src/app.ts", "my dir/notes.md"]) {
    const text = attachmentTokenText(path);
    const tokens = findAttachmentTokens(text);
    assert.equal(tokens.length, 1, path);
    assert.equal(tokens[0].path, path, path);
    const rebuilt = attachmentTokenText(tokens[0].path);
    assert.equal(rebuilt, text);
  }
  const composed = "see " + attachmentTokenText("/tmp/a.png") + ' and @"my dir/n.md" now';
  assert.equal(findAttachmentTokens(composed).length, 2);
});

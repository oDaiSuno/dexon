import assert from "node:assert/strict";
import test from "node:test";
import * as quotes from "../../src/shared/quote-tokens.ts";
import { importTestBundle } from "#test-bundle";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const {
  readPromptIntent,
  titleSourceOf,
  turnTitleOf,
  userMessageRemarkPlugins,
  userMessageRemarkRehypeOptions,
  userMessageRehypePlugins,
} = await importTestBundle("quote-user-message", {
  packages: "external",
  tsconfig: "tsconfig.renderer.json",
  stdin: {
    contents:
      'export { readPromptIntent, titleSourceOf } from "./src/shared/prompt-intent.ts"; export { turnTitleOf } from "./src/shared/turn-title.ts"; export * from "./src/renderer/lib/markdown.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
});

const sample = {
  id: "draft-1",
  text: "中文 😀\n@src/main.ts /skill:review \"double\" 'single' & <tag> \uE000\uE001",
  from: "assistant",
  entryId: "e1",
  prefix: "before\n",
  suffix: "\rafter",
};

test("composer quotes preserve Unicode and coordinates without exposing prose delimiters", () => {
  const token = quotes.encodeComposerQuoteToken(sample);
  assert.ok(token.startsWith("\uE000quote:"));
  assert.ok(token.endsWith("\uE001"));
  assert.doesNotMatch(token, /[\s@/"']/);
  assert.deepEqual(quotes.decodeComposerQuoteToken(token), sample);
  const anonymous = quotes.decodeComposerQuoteToken(quotes.encodeComposerQuoteToken({ text: "hello", from: "user" }));
  assert.equal(typeof anonymous.id, "string");
  assert.equal(anonymous.text, "hello");
  assert.equal(anonymous.from, "user");
});

test("malformed composer payloads remain ordinary text instead of becoming quotes", () => {
  for (const token of [
    "plain",
    "\uE000quote:%broken\uE001",
    "\uE000quote:%7B%7D\uE001",
    ...[
      null,
      [],
      { id: 1, text: "x", from: "user" },
      { id: "1", text: "x", from: "tool" },
      { id: "1", text: "x", from: "user", prefix: 1 },
    ].map((value) => `\uE000quote:${encodeURIComponent(JSON.stringify(value))}\uE001`),
  ])
    assert.equal(quotes.decodeComposerQuoteToken(token), null);
  const first = quotes.encodeComposerQuoteToken(sample);
  const secondQuote = { id: "draft-2", text: "second", from: "user" };
  const second = quotes.encodeComposerQuoteToken(secondQuote);
  const broken = "\uE000quote:%broken\uE001";
  assert.deepEqual(quotes.segmentByComposerQuoteTokens(`before${first}${second} after ${broken}`), [
    { type: "text", text: "before" },
    { type: "quote", quote: sample },
    { type: "quote", quote: secondQuote },
    { type: "text", text: ` after ${broken}` },
  ]);
  assert.deepEqual(quotes.segmentByComposerQuoteTokens(""), [{ type: "text", text: "" }]);
  assert.deepEqual(quotes.segmentByComposerQuoteTokens(broken), [{ type: "text", text: broken }]);
});

const simple = {
  id: "draft-a",
  text: "verbatim text",
  from: "assistant",
  entryId: "e1",
  prefix: "before",
  suffix: "after",
};
const envelope =
  '<quotes>\n<quote id="1" from="assistant" entry="e1" pre="before" suf="after">\nverbatim text\n</quote>\n</quotes>';

test("sending a quote creates a numbered footnote envelope and editing restores its inline position", () => {
  const token = quotes.encodeComposerQuoteToken(simple);
  const sent = quotes.serializeComposerQuotesForSend(`对照 ${token} 和 @src/main.ts`);
  assert.equal(sent, `${envelope}\n\n对照 [quote:1] 和 @src/main.ts`);
  assert.deepEqual(quotes.parseQuotedPrompt(sent), {
    quotes: [{ ...simple, id: "1" }],
    body: "对照 [quote:1] 和 @src/main.ts",
  });
  const restored = quotes.expandQuotedPromptToComposerText(sent);
  assert.equal(restored, `对照 ${quotes.encodeComposerQuoteToken({ ...simple, id: "1" })} 和 @src/main.ts`);
  assert.equal(quotes.serializeComposerQuotesForSend(restored), sent);
  for (const text of ["", "  plain\nprose  ", "[quote:1] alone", "\uE000quote:broken\uE001"]) {
    assert.equal(quotes.serializeComposerQuotesForSend(text), text);
    assert.deepEqual(quotes.parseQuotedPrompt(text), { quotes: [], body: text });
    assert.equal(quotes.expandQuotedPromptToComposerText(text), text);
  }
});

test("footnotes preserve multiline bodies, nested closing tags, literal escape sequences and XML attributes", () => {
  for (const text of [
    "first\nsecond",
    "\n  indented\r\n\n",
    "a </quote> </quotes> z",
    String.raw`a <\/quote> <\\/quotes> z`,
    '😀\u0000 & < > "quoted"',
  ]) {
    const quote = { id: "draft", text, from: "user", entryId: '&"<>\n\r', prefix: "&amp; &#10;", suffix: "" };
    const sent = quotes.serializeComposerQuotesForSend(quotes.encodeComposerQuoteToken(quote));
    assert.ok(
      sent.startsWith(
        '<quotes>\n<quote id="1" from="user" entry="&amp;&quot;&lt;&gt;&#10;&#13;" pre="&amp;amp; &amp;#10;" suf="">\n',
      ),
    );
    assert.deepEqual(quotes.parseQuotedPrompt(sent), { quotes: [{ ...quote, id: "1" }], body: "[quote:1]" });
    assert.equal(quotes.serializeComposerQuotesForSend(quotes.expandQuotedPromptToComposerText(sent)), sent);
  }
});

test("multiple quotes are numbered by appearance and quote-only messages keep separated references", () => {
  const first = quotes.encodeComposerQuoteToken(simple);
  const second = quotes.encodeComposerQuoteToken({ id: "draft-a", text: "second", from: "user" });
  const sent = quotes.serializeComposerQuotesForSend(` \n${first}${second} \n`);
  assert.deepEqual(quotes.parseQuotedPrompt(sent), {
    quotes: [
      { ...simple, id: "1" },
      { id: "2", text: "second", from: "user" },
    ],
    body: "[quote:1] [quote:2]",
  });
  const restored = quotes.segmentByComposerQuoteTokens(quotes.expandQuotedPromptToComposerText(sent));
  assert.deepEqual(
    restored.map((segment) => segment.type),
    ["quote", "text", "quote"],
  );
  assert.equal(quotes.serializeComposerQuotesForSend(quotes.expandQuotedPromptToComposerText(sent)), sent);
});

const skillPrefix =
  '<skill name="review" location="/skills/review/SKILL.md">\nInstructions with @src/instructions.ts\n</skill>\n\n';

test("typed and expanded skills stay ahead of the quote envelope through sending and editing", () => {
  const token = quotes.encodeComposerQuoteToken(simple);
  for (const prefix of ["/skill:review ", skillPrefix]) {
    const sent = quotes.serializeComposerQuotesForSend(`${prefix}check ${token}`);
    assert.equal(sent, `${prefix}${envelope}\n\ncheck [quote:1]`);
    assert.deepEqual(quotes.parseQuotedPrompt(sent), { quotes: [{ ...simple, id: "1" }], body: "check [quote:1]" });
    const restored = quotes.expandQuotedPromptToComposerText(sent);
    assert.equal(restored, `${prefix}check ${quotes.encodeComposerQuoteToken({ ...simple, id: "1" })}`);
    assert.equal(quotes.serializeComposerQuotesForSend(restored), sent);
    assert.equal(quotes.serializeComposerQuotesForSend(`${prefix}plain`), `${prefix}plain`);
  }
  assert.equal(
    quotes.serializeComposerQuotesForSend(`/skill:review \n${token}`),
    `/skill:review ${envelope}\n\n[quote:1]`,
  );
});

test("editing preserves repeated references and restores quotes with no visible reference", () => {
  const repeated = quotes.expandQuotedPromptToComposerText(`${envelope}\n\n[quote:1] then [quote:1] and [quote:9]`);
  const token = quotes.encodeComposerQuoteToken({ ...simple, id: "1" });
  assert.equal(repeated, `${token} then ${token} and [quote:9]`);
  assert.equal(quotes.expandQuotedPromptToComposerText(`${envelope}\n\nquestion`), `${token} question`);
  assert.equal(quotes.expandQuotedPromptToComposerText(envelope), token);
});

test("only a complete valid leading envelope is parsed", () => {
  for (const text of [
    `prefix ${envelope}`,
    `\n${envelope}`,
    `<quotes>\n</quotes>`,
    `${envelope}tail`,
    envelope.replace('from="assistant"', 'from="tool"'),
    envelope.replace('id="1"', 'id="0"'),
    envelope.replace('id="1"', 'id="1" id="2"'),
    envelope.replace("</quote>", "</quot>"),
    envelope.replace("\n</quotes>", "\ngarbage\n</quotes>"),
  ])
    assert.deepEqual(quotes.parseQuotedPrompt(text), { quotes: [], body: text });
});

const strippedEnvelope = '<quotes>\n<quote id="1" from="assistant">\nverbatim text\n</quote>\n</quotes>';

test("context stripping removes only jump coordinates and is byte-identical after the first pass", () => {
  for (const prefix of ["", "/skill:review ", skillPrefix]) {
    const input = `${prefix}${envelope}\n\ncheck [quote:1]`;
    const expected = `${prefix}${strippedEnvelope}\n\ncheck [quote:1]`;
    assert.equal(quotes.stripQuoteCoordinates(input), expected);
    assert.equal(quotes.stripQuoteCoordinates(expected), expected);
  }
  const input =
    '<quotes>\n<quote pre="a &quot; &gt;" id="2" entry="e" from="user" suf="b">\n<quote entry="literal">body</quote>\n</quote>\n</quotes>\n\n[quote:2]';
  const expected =
    '<quotes>\n<quote id="2" from="user">\n<quote entry="literal">body</quote>\n</quote>\n</quotes>\n\n[quote:2]';
  assert.equal(quotes.stripQuoteCoordinates(input), expected);
  for (const text of [
    "plain",
    '<quote entry="outside">ordinary prose</quote>',
    `prefix ${envelope}`,
    strippedEnvelope,
  ]) {
    assert.equal(quotes.stripQuoteCoordinates(text), text);
  }
});

test("message stripping changes only user text and reuses every unaffected object and array", () => {
  const image = { type: "image", data: "AA==" };
  const untouchedBlock = { type: "text", text: "unchanged" };
  const changedBlock = { type: "text", text: envelope, extra: true };
  const assistant = { role: "assistant", content: envelope };
  const messages = [
    { role: "user", content: envelope, timestamp: 10 },
    { role: "user", content: [untouchedBlock, image, changedBlock, null, { type: "text", text: 12 }] },
    assistant,
    { role: "toolResult", content: envelope },
    { role: "user" },
  ];
  const result = quotes.stripQuoteCoordinatesFromMessages(messages);
  assert.notEqual(result, messages);
  assert.deepEqual(result[0], { role: "user", content: strippedEnvelope, timestamp: 10 });
  assert.notEqual(result[1].content, messages[1].content);
  assert.equal(result[1].content[0], untouchedBlock);
  assert.equal(result[1].content[1], image);
  assert.deepEqual(result[1].content[2], { ...changedBlock, text: strippedEnvelope });
  assert.equal(result[1].content[3], null);
  assert.equal(result[1].content[4], messages[1].content[4]);
  for (let index = 2; index < messages.length; index++) assert.equal(result[index], messages[index]);
  assert.equal(messages[0].content, envelope);
  assert.equal(changedBlock.text, envelope);
  assert.equal(quotes.stripQuoteCoordinatesFromMessages(result), result);
  const unchanged = [assistant, { role: "user", content: [untouchedBlock, image] }];
  assert.equal(quotes.stripQuoteCoordinatesFromMessages(unchanged), unchanged);
  const empty = [];
  assert.equal(quotes.stripQuoteCoordinatesFromMessages(empty), empty);
});

test("quote snippets collapse whitespace and truncate by Unicode characters including the ellipsis", () => {
  assert.equal(quotes.quoteSnippet(" \n first\tsecond\r\nthird "), "first second third");
  assert.equal(quotes.quoteSnippet("abcdefghijklmnopqrstuvwxyz123"), "abcdefghijklmnopqrstuvwxyz1…");
  assert.equal(quotes.quoteSnippet("😀😀😀😀", 3), "😀😀…");
  assert.equal(quotes.quoteSnippet("first second", 7), "first…");
  assert.equal(quotes.quoteSnippet("text", 1), "…");
  assert.equal(quotes.quoteSnippet("text", 0), "");
});

test("copy produces readable excerpts without the transport envelope or composer tokens", () => {
  assert.equal(quotes.formatQuotedPromptForCopy(`${envelope}\n\n[quote:1]`), "verbatim text");
  assert.equal(quotes.formatQuotedPromptForCopy(`${envelope}\n\n \n[quote:1] \n`), "verbatim text");
  assert.equal(
    quotes.formatQuotedPromptForCopy(`${envelope}\n\ncompare [quote:1] with @src/main.ts`),
    "compare 「verbatim text」 with @src/main.ts",
  );
  assert.equal(quotes.formatQuotedPromptForCopy(`${envelope}\n\nquestion`), "> verbatim text\n\nquestion");
  assert.equal(quotes.formatQuotedPromptForCopy(quotes.encodeComposerQuoteToken(simple)), "verbatim text");
  const multiline = quotes.encodeComposerQuoteToken({ text: "first\nsecond", from: "user" });
  assert.equal(quotes.formatQuotedPromptForCopy(multiline), "first\nsecond");
  assert.equal(quotes.formatQuotedPromptForCopy(`explain ${multiline}`), "explain 「first\nsecond」");
  assert.equal(
    quotes.formatQuotedPromptForCopy(`/skill:review ${envelope}\n\ncheck [quote:1]`),
    "/skill:review check 「verbatim text」",
  );
  assert.equal(quotes.formatQuotedPromptForCopy("  ordinary text\n"), "  ordinary text\n");
});

test("quote titles prefer the user question and use a short excerpt for quote-only prompts", () => {
  const token = quotes.encodeComposerQuoteToken(simple);
  for (const text of [`${envelope}\n\ncompare [quote:1] now`, `compare ${token} now`]) {
    assert.equal(quotes.quoteTitleText(text), "compare now");
  }
  for (const text of [`${envelope}\n\n[quote:1]`, envelope, token]) {
    assert.equal(quotes.quoteTitleText(text), "verbatim text");
  }
  assert.equal(quotes.quoteTitleText(`/skill:review ${envelope}\n\ncheck [quote:1]`), "/skill:review check");
  assert.equal(quotes.quoteTitleText(`/skill:review ${token}`), "/skill:review verbatim text");
  assert.equal(quotes.quoteTitleText(`${skillPrefix}${token}`), "/skill:review verbatim text");
  assert.equal(
    quotes.quoteTitleText(quotes.encodeComposerQuoteToken({ text: "x".repeat(80), from: "user" })),
    `${"x".repeat(59)}…`,
  );
  assert.equal(quotes.quoteTitleText("  ordinary\nquestion  "), "ordinary question");
});

test("session and turn titles never show quote metadata for prose, skills or structured messages", () => {
  const sent = `${envelope}\n\nexplain [quote:1] now`;
  assert.deepEqual(titleSourceOf(readPromptIntent(sent)), { goal: "explain now" });
  assert.deepEqual(titleSourceOf(readPromptIntent(`/skill:review ${sent}`)), { goal: "explain now", skill: "review" });
  assert.deepEqual(titleSourceOf(readPromptIntent(`${skillPrefix}${sent}`)), { goal: "explain now", skill: "review" });
  assert.equal(turnTitleOf(sent), "explain now");
  assert.equal(turnTitleOf(`/skill:review ${sent}`), "/skill:review explain now");
  assert.equal(turnTitleOf(`${skillPrefix}${sent}`), "/skill:review explain now");
  assert.equal(
    turnTitleOf([
      { type: "text", text: sent },
      { type: "image", source: {} },
    ]),
    "explain now",
  );
  const token = quotes.encodeComposerQuoteToken(simple);
  assert.deepEqual(titleSourceOf(readPromptIntent(`explain ${token} now`)), { goal: "explain now" });
  assert.equal(turnTitleOf(token), "verbatim text");
  assert.equal(turnTitleOf(`/skill:review ${token}`), "/skill:review verbatim text");
  assert.deepEqual(titleSourceOf(readPromptIntent(`${envelope}\n\n[quote:1]`)), { goal: "verbatim text" });
  assert.equal(turnTitleOf("ordinary\nquestion"), "ordinary question");
  assert.equal(turnTitleOf("a".repeat(210)).length, 200);
});

test("Markdown parses inline quote references without consuming code or ordinary bracketed text", async () => {
  const source =
    "对照[quote:1]和 **[quote:23]** @src/main.ts `code [quote:2]`\n\n```text\n[quote:3]\n```\n\n    [quote:4]\n\n[quote:0] [quote:x] [quote:01] [quote:5x] \\[quote:6]";
  const processor = unified().use(remarkParse).use(userMessageRemarkPlugins);
  const tree = await processor.run(processor.parse(source), source);
  const nodes = [];
  visit(tree, (node) => {
    nodes.push(node);
  });
  assert.deepEqual(
    nodes.filter((node) => node.type === "quoteToken").map(({ type, quoteId, raw }) => ({ type, quoteId, raw })),
    [
      { type: "quoteToken", quoteId: "1", raw: "[quote:1]" },
      { type: "quoteToken", quoteId: "23", raw: "[quote:23]" },
    ],
  );
  assert.deepEqual(
    nodes.filter((node) => node.type === "inlineCode").map((node) => node.value),
    ["code [quote:2]"],
  );
  assert.deepEqual(
    nodes.filter((node) => node.type === "code").map((node) => node.value),
    ["[quote:3]", "[quote:4]"],
  );
  assert.equal(nodes.filter((node) => node.type === "attachmentToken").length, 1);
});

test("the renderer Markdown pipeline preserves quote chip data and its sanitized visible fallback", async () => {
  const source = "check [quote:1] with @src/main.ts <script>unsafe()</script>";
  const processor = unified()
    .use(remarkParse)
    .use(userMessageRemarkPlugins)
    .use(remarkRehype, userMessageRemarkRehypeOptions)
    .use(userMessageRehypePlugins);
  const tree = await processor.run(processor.parse(source), source);
  const elements = [];
  visit(tree, "element", (node) => {
    elements.push(node);
  });
  const quote = elements.find((node) => node.data?.quoteToken);
  assert.ok(quote);
  assert.equal(quote.tagName, "span");
  assert.deepEqual(quote.data.quoteToken, { quoteId: "1", raw: "[quote:1]" });
  assert.equal(quote.properties.dataQuoteRef, "1");
  assert.deepEqual(quote.children, [{ type: "text", value: "[quote:1]" }]);
  assert.ok(elements.some((node) => node.data?.attachmentToken?.path === "src/main.ts"));
  assert.equal(
    elements.some((node) => node.tagName === "script"),
    false,
  );
});

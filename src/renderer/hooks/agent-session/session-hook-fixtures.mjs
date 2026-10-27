/**
 * Fixture stand-ins for the session-hook harness: fake DOM events and
 * elements and session-detail/reading-surface
 * builders. Kept separate from the harness orchestration so every file
 * stays inside the 500-line budget.
 */

export class FakeDomEvent {
  constructor(props = {}) {
    Object.assign(this, props);
  }
}

export class FakeKeyboardEvent extends FakeDomEvent {}
export class FakeWheelEvent extends FakeDomEvent {}
export class FakeTouchEvent extends FakeDomEvent {}

export class FakeElement {
  constructor(name = "element") {
    this.name = name;
    this.listeners = new Map();
    this.scrollTop = 0;
    this.scrollHeight = 120;
    this.clientHeight = 120;
    this.offsetTop = 0;
    this.rectTop = 0;
    this.scrollCalls = [];
    this.scrollIntoViewCalls = [];
  }
  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  }
  dispatch(type, event) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
  querySelector() {
    return null;
  }
  closest() {
    return null;
  }
  getBoundingClientRect() {
    return { top: this.rectTop };
  }
  scrollTo(options) {
    this.scrollCalls.push(options);
  }
  scrollIntoView(options) {
    this.scrollIntoViewCalls.push(options);
  }
}

export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
  };
}

function summarizeMessages(messages) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let cost = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;
  let toolResults = 0;
  for (const message of messages) {
    if (message.role === "user") userMessages += 1;
    if (message.role === "toolResult") toolResults += 1;
    if (message.role !== "assistant") continue;
    assistantMessages += 1;
    const content = Array.isArray(message.content) ? message.content : [];
    toolCalls += content.filter((block) => block.type === "toolCall").length;
    const usage = message.usage;
    if (!usage) continue;
    tokens.input += usage.input ?? 0;
    tokens.output += usage.output ?? 0;
    tokens.cacheRead += usage.cacheRead ?? 0;
    tokens.cacheWrite += usage.cacheWrite ?? 0;
    cost += usage.cost?.total ?? 0;
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return {
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages: messages.length,
    tokens,
    cost,
  };
}

/** Minimal SessionDetail fixture matching the host contract. */
export function createSessionDetail(id, options = {}) {
  const messages = options.messages ?? [
    { role: "user", content: "fixture", timestamp: 1 },
    {
      role: "assistant",
      content: [{ type: "text", text: "fixture reply" }],
      provider: "fixture",
      model: "fixture-model",
      stopReason: "stop",
      timestamp: 2,
    },
  ];
  const info = {
    id,
    path: `/fixture/${id}.jsonl`,
    cwd: options.cwd ?? "/fixture",
    created: "",
    modified: "",
    messageCount: options.messageCount ?? 2,
    firstMessage: options.firstMessage ?? "fixture",
    ...(options.name ? { name: options.name } : {}),
  };
  return {
    sessionId: id,
    filePath: `/fixture/${id}.jsonl`,
    info,
    leafId: `${id}-assistant`,
    tree: options.tree ?? [],
    stats: options.stats ?? summarizeMessages(messages),
    context: {
      messages,
      entryIds: options.entryIds ?? [`${id}-user`, `${id}-assistant`],
      model: options.model ?? { provider: "fixture", modelId: "fixture-model" },
      thinkingLevel: options.thinkingLevel ?? "off",
      historyRevision: options.historyRevision ?? `${id}-revision`,
      previousCursor: options.previousCursor ?? null,
      ...(options.outline ? { outline: options.outline } : {}),
      totalMessages: options.totalMessages ?? messages.length,
      loadedMessages: messages.length,
      truncatedBefore: false,
    },
    ...(options.agentState !== undefined ? { agentState: options.agentState } : { agentState: { running: false } }),
    ...(options.contextUsage !== undefined ? { contextUsage: options.contextUsage } : {}),
  };
}

/** Fake scroll container with anchor elements for reading-side tests. */
export function createReadingSurface({ scrollTop = 40, scrollHeight = 200, clientHeight = 120 } = {}) {
  const container = new FakeElement("scroll-container");
  container.scrollTop = scrollTop;
  container.scrollHeight = scrollHeight;
  container.clientHeight = clientHeight;
  const liveEnd = new FakeElement("live-end");
  const messagesEnd = new FakeElement("messages-end");
  const lastUserMsg = new FakeElement("last-user-msg");
  return { container, liveEnd, messagesEnd, lastUserMsg };
}

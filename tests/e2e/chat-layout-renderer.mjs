import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ChatWindow } from "../../src/renderer/components/ChatWindow.tsx";
import { applyChatAppearance } from "../../src/renderer/lib/chat-appearance.ts";
import { ThinkingExpansionStore } from "../../src/renderer/lib/thinking-expansion-store.ts";
import { setAppLanguage } from "../../src/renderer/i18n.ts";
import { resetRpc } from "../../src/renderer/lib/api-client.ts";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../fixtures/session-host.mjs";
import { byRole, getByRole, text } from "../support/dom-queries.mjs";
import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";
import "./production-styles.mjs";

const window = globalThis.window;
const document = globalThis.document;
setAppLanguage("en-US");
const extensionState = {
  running: false,
  state: {
    extensionUi: {
      runtimeId: "native-runtime",
      revision: 1,
      completed: [],
      requests: [
        {
          type: "extension_ui_request",
          id: "native-question",
          method: "confirm",
          title: "Confirm native operation",
          message: "The conversation stays usable while deciding.",
        },
      ],
    },
  },
};
const shortMessages = [
  { role: "user", content: "Native user message", timestamp: 1 },
  {
    role: "assistant",
    content: [{ type: "text", text: "Native assistant reply" }],
    provider: "fixture",
    model: "fixture-model",
    stopReason: "stop",
    timestamp: 2,
  },
];
const longMessages = [
  ...shortMessages,
  ...Array.from({ length: 12 }, (_value, index) => [
    {
      role: "user",
      content: `Long question ${index + 1} asks how the conversation is laid out.`,
      timestamp: index * 2 + 3,
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: `Long reply ${index + 1} keeps the conversation taller than one screen so the scrollbar appears. It stays plain prose, like a real answer, so every line keeps the same height.`,
        },
      ],
      provider: "fixture",
      model: "fixture-model",
      stopReason: "stop",
      timestamp: index * 2 + 4,
    },
  ]),
].flat();
function detailFor(messages) {
  return createSessionDetail("native-chat", { messages, agentState: extensionState });
}
let detail = detailFor(shortMessages);
const host = createSessionTestHost({
  getSession: async () => detail,
  agentState: async () => ({ running: false }),
});
window.piBridge = {};
const boundary = installApiHostBridge(window, () => host, resetRpc);
const root = createRoot(document.getElementById("root"));
const thinkingExpansionStore = new ThinkingExpansionStore();
const processDetailsExpansionStore = new ThinkingExpansionStore();
let epoch = 0;
window.chatLayout = {
  find(role, name) {
    const chat = byRole(document, "region", "Chat");
    return chat ? byRole(chat, role, name) : undefined;
  },
  elements() {
    const chat = getByRole(document, "region", "Chat");
    const composer = getByRole(chat, "group", "Message input");
    const conversation = byRole(chat, "region", "Conversation");
    const messages = conversation ? getByRole(conversation, "group", "Messages") : null;
    return {
      editor: getByRole(composer, "textbox"),
      composer,
      card: byRole(chat, "region", "Tool interaction"),
      messages,
      user: messages ? text(messages, "Native user message") : null,
      assistant: messages ? text(messages, "Native assistant reply") : null,
      title: text(chat, "Dexon"),
    };
  },
  configure({ font = "standard", layout = "fixed", theme = "light", welcome = false, conversation = "short" } = {}) {
    detail = detailFor(conversation === "long" ? longMessages : shortMessages);
    applyChatAppearance(document.documentElement, { fontSize: font, layout });
    // A persisted preference keeps the real theme Hook from correctly
    // replacing a temporary class with the current OS theme after mounting.
    window.localStorage.setItem("pi-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    document.getElementById("root").style.height = "100vh";
    flushSync(() =>
      root.render(
        createElement(ChatWindow, {
          key: ++epoch,
          session: welcome ? null : detail.info,
          newSessionCwd: welcome ? "/fixture" : null,
          thinkingExpansionStore,
          processDetailsExpansionStore,
          onSessionCreated() {},
          onAgentEnd() {},
          onOpenFile() {},
        }),
      ),
    );
  },
  commands: () => structuredClone(host.sendCommands),
  close() {
    try {
      flushSync(() => root.unmount());
    } finally {
      boundary.close();
    }
  },
};
window.chatLayout.configure();

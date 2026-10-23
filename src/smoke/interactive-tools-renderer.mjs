import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { setAppLanguage } from "../renderer/i18n.ts";
import { ToolCardDock } from "../renderer/components/interactive-tools/tool-card-dock.tsx";
import { InteractiveToolStore } from "../renderer/lib/interactive-tool-store.ts";
import "../renderer/styles/tokens.css";
import "../renderer/styles/base.css";
import "../renderer/styles/motion-tokens.css";
import "../renderer/styles/chat-scope.css";
import "../renderer/styles/chat-motion.css";
import "../renderer/styles/chat-shared.css";
import "../renderer/styles/messages-process.css";
import "../renderer/styles/messages-failure.css";
import "../renderer/styles/messages-stream.css";
import "../renderer/styles/tool-cards.css";

const document = globalThis.document;
const window = globalThis.window;
setAppLanguage("zh-CN");
const root = createRoot(document.getElementById("cards"));
let store;
let nonce = 0;
let live = false;
const q = {
  question: "How should we organize this release?",
  header: "Release",
  options: [
    {
      label: "Small, reversible changes",
      description: "Keep the current behavior while improving one part at a time.",
      preview:
        "// Full source preview\n" +
        "const next = preserveExistingAnswers(current);\n".repeat(30) +
        "<script>window.previewExecuted=true</script>",
    },
    { label: "A coordinated update", description: "Review the full scope before making the changes together." },
  ],
};
const paint = async () => {
  await document.fonts.ready;
  await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  await Promise.all(
    document
      .getAnimations()
      .filter((a) => a.effect?.getTiming().iterations !== Infinity)
      .map((a) => a.finished.catch(() => {})),
  );
};
function render() {
  flushSync(() => root.render(createElement(ToolCardDock, { key: nonce, store })));
}
function button(label) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent.trim() === label,
  );
}
window.fixture = {
  async configure({ theme = "light", font = "standard", mode = "single", width = 768, long = false } = {}) {
    live = false;
    nonce++;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.chatFontSize = font;
    document.getElementById("canvas").style.width = `${width + 48}px`;
    const multiSelect = mode === "multi";
    const question = { ...q, multiSelect, ...(long ? { question: q.question.repeat(12) } : {}) };
    const req = {
      type: "extension_ui_request",
      id: `preview-${nonce}`,
      method: "questionnaire",
      questions: [question, { ...q, question: "Which constraints matter most?" }, q, q],
    };
    if (mode === "editor")
      Object.assign(req, {
        method: "editor",
        title: "Review the full draft",
        prefill: "long editor content\n".repeat(100),
      });
    store = new InteractiveToolStore("visual", async (_sid, command) => {
      if (mode === "failed") throw new Error("Simulated delivery failure");
      return { id: command.id, status: "submitted" };
    });
    store.reconcile({ runtimeId: "visual-runtime", revision: 1, requests: [req], completed: [] });
    if (["multi", "failed"].includes(mode))
      store.updateDraft(req.id, (d) => ({
        ...d,
        answers: [
          { selected: multiSelect ? [0, 1] : [0], text: multiSelect ? "Preserve my written notes as well." : "" },
          ...d.answers.slice(1),
        ],
      }));
    if (mode === "collapsed") store.setCollapsed(req.id, true);
    if (mode === "failed") await store.respond(req.id, { answers: store.getSnapshot().entries[0].draft.answers });
    render();
    if (mode === "abandon") button("放弃本次回答").click();
    if (mode === "preview") flushSync(() => document.querySelector(".tool-preview-toggle").click());
    await paint();
    return this.inspect();
  },
  async click(label) {
    const b = button(label);
    if (!b || b.disabled) throw new Error(`Missing or disabled button: ${label}`);
    b.click();
    await paint();
  },
  async edit(value) {
    const input = document.querySelector(
      ".tool-card input:not([type=radio]):not([type=checkbox]), .tool-card textarea",
    );
    const prototype =
      input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await paint();
  },
  inspect() {
    const card = document.querySelector(".tool-card");
    const body = document.querySelector(".tool-body-scroll");
    const primary = document.querySelector(".tool-primary");
    const rect = card?.getBoundingClientRect();
    const overflow = [...document.querySelectorAll(".tool-card *")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width && r.right > rect.right + 1 && !e.closest("pre") && !e.closest(".tool-number-window");
      })
      .map((e) => e.className || e.tagName);
    return {
      count: store.getSnapshot().entries.filter((e) => ["pending", "failed", "sending"].includes(e.status)).length,
      state: store.getSnapshot(),
      overflow,
      cardWidth: rect?.width,
      composerVisible: document.querySelector(".composer").getBoundingClientRect().bottom <= window.innerHeight,
      primaryVisible: !primary || primary.getBoundingClientRect().bottom <= window.innerHeight,
      bodyScroll: !!body && body.scrollHeight > body.clientHeight,
      previewLength: document.querySelector(".tool-preview")?.textContent.length ?? 0,
      previewExecuted: !!window.previewExecuted,
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      motion: [...document.querySelectorAll(".tool-card *")].map((e) => {
        const css = window.getComputedStyle(e);
        return { animation: css.animationName, transition: css.transitionDuration };
      }),
    };
  },
  async connect() {
    live = true;
    nonce++;
    store = new InteractiveToolStore(
      "sdk-window",
      (_sid, command) => window.toolHarness.command(command),
      window.sessionStorage,
    );
    store.reconcile(await window.toolHarness.snapshot());
    render();
    await paint();
  },
  async start() {
    await window.toolHarness.start();
    await paint();
  },
  async settle() {
    await window.toolHarness.settled();
    await paint();
    return this.inspect();
  },
  async frame() {
    await paint();
  },
};
window.toolHarness?.onSnapshot((snapshot) => {
  if (live) {
    store.reconcile(snapshot);
  }
});

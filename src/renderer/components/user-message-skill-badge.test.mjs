import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";

// jsdom globals must be in place before the bundle imports.

const { UserMessageView } = await importTestBundle("src/renderer/components/user-message-skill-badge", {
  stdin: {
    contents: 'export { UserMessageView } from "./messages/UserMessage.tsx";',
    resolveDir: import.meta.dirname,
    sourcefile: "user-message-skill-badge-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  jsx: "automatic",
  external: ["react", "react/jsx-runtime", "react-dom", "react-dom/*", "react-markdown", "mermaid"],
  plugins: [
    {
      // Same stub set as markdown-body-component-identity.test.mjs: keep the
      // component graph renderable in Node without heavy markdown tooling.
      name: "user-message-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => ({ path: args.path, namespace: "stub" }));
        build.onResolve({ filter: /^\.\/SessionProfiler$/ }, () => ({ path: "profiler", namespace: "stub" }));
        build.onResolve({ filter: /^\.\/shared$/ }, () => ({ path: "shared", namespace: "stub" }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
          loader: "js",
          contents:
            args.path === "@/hooks/useTheme"
              ? "export const useTheme = () => ({ isDark: false });"
              : args.path === "@/i18n"
                ? "export const useI18n = () => ({ language: 'en-US', t: (_key, fallback) => fallback });"
                : args.path === "@/lib/file-links"
                  ? "export const resolveLocalFileHref = () => null;"
                  : args.path === "@/lib/markdown"
                    ? "export const markdownRehypePlugins = []; export const markdownRemarkPlugins = [];"
                    : args.path === "@/lib/code-highlight-policy"
                      ? "export const shouldHighlightCode = () => false;"
                      : args.path === "@/lib/chat-appearance"
                        ? "export const scaledChatFont = (value) => value;"
                        : args.path === "@/lib/mermaid-renderer"
                          ? "export const mermaidCacheKey = () => 'key'; export const renderMermaidSvg = async () => '<svg />';"
                          : args.path === "@/hooks/useCopyFeedback"
                            ? "export const useCopyFeedback = () => ({ copied: false, copy: async () => true });"
                            : args.path === "@/lib/syntax-highlight"
                              ? "export const SyntaxHighlighter = 'pre'; export const vs = {}; export const vscDarkPlus = {};"
                              : args.path === "@/lib/attachment-token-previews"
                                ? "export const loadAttachmentPreview = async () => null; export const registerStagedPreviewUrl = () => {}; export const resolveStagedPreviewUrl = (url) => url ?? null;"
                                : args.path === "@/lib/channel-message-style"
                                  ? "export const getUserBubbleStyle = () => ({ background: '#fff', foreground: '#000' });"
                                  : args.path === "shared"
                                    ? "export const DeferredContentActions = () => null; export const formatTime = () => '';"
                                    : "export const SessionProfiler = ({ children }) => children;",
        }));
      },
    },
  ],
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

let mounted = null;

async function renderMessage(content) {
  const element = createElement(UserMessageView, {
    message: { role: "user", content, timestamp: Date.now() },
    cwd: "/workspace/project",
  });
  await act(async () => {
    mounted = createRoot(rootEl);
    mounted.render(element);
  });
  await flush();
}

async function unmount() {
  if (!mounted) return;
  const root = mounted;
  mounted = null;
  await act(async () => {
    root.unmount();
  });
  rootEl.textContent = "";
}

after(async () => {
  await harness.restoreGlobals?.();
  restoreGlobals();
});

test("a message starting with /skill:name renders a blue badge plus the prose", async () => {
  await renderMessage("/skill:fast-context 帮我梳理架构");
  const badge = Array.from(rootEl.querySelectorAll("span")).find((el) => el.textContent === "fast-context");
  assert.ok(badge, "the badge names the skill");
  assert.ok(rootEl.textContent.includes("帮我梳理架构"), "the prose stays in the bubble");
  await unmount();
});

test("a bare /skill:name message renders only the badge", async () => {
  await renderMessage("/skill:groksearch");
  assert.ok(Array.from(rootEl.querySelectorAll("span")).some((el) => el.textContent === "groksearch"));
  await unmount();
});

test("pi's expanded <skill> block renders as the badge plus prose", async () => {
  await renderMessage(
    '<skill name="fast-context" location="/home/u/.pi/agent/skills/fast-context/SKILL.md">\nReferences are relative to /home/u/.pi/agent/skills/fast-context.\n\nBody.\n</skill>\n\n帮我梳理架构',
  );
  const badge = Array.from(rootEl.querySelectorAll("span")).find((el) => el.textContent === "fast-context");
  assert.ok(badge, "the expanded block shows as a badge");
  assert.ok(rootEl.textContent.includes("帮我梳理架构"), "trailing args stay in the bubble");
  assert.ok(!rootEl.textContent.includes("<skill"), "the raw XML block is hidden");
  await unmount();
});

test("mid-message /skill text is prose and gets no badge", async () => {
  await renderMessage("请先读 /skill:fast-context 说明");
  assert.ok(
    !Array.from(rootEl.querySelectorAll("span")).some((el) => el.textContent === "fast-context"),
    "no badge for a non-leading command",
  );
  assert.ok(rootEl.textContent.includes("请先读 /skill:fast-context 说明"));
  await unmount();
});

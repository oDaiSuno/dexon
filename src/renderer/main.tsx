import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import { App } from "./App";
// Style cascade order lives in these imports: tailwind/theme/fonts first, then
// app partials by responsibility, then the chat surface overrides.
import "./globals.css";
import "./styles/tokens.css";
import "./styles/motion-tokens.css";
import "./styles/base.css";
import "./styles/sidebar.css";
import "./styles/composer.css";
import "./styles/markdown.css";
import "./styles/motion.css";
import "./styles/nav.css";
import "./styles/panels.css";
import "./styles/chat-scope.css";
import "./styles/chat-motion.css";
import "./styles/chat-window.css";
import "./styles/messages.css";
import "./styles/tool-cards.css";
import { ensureRpc } from "./lib/api-client";
import { installApiShims } from "./lib/api-fetch";

// Install /api fetch + EventSource shims before any component mounts
installApiShims();

// Boot RPC early so the first UI interactions are ready
void ensureRpc().catch((err) => {
  console.error("[dexon] failed to connect to agent host:", err);
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

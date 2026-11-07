import type { BrowserWindow } from "electron";
import path from "node:path";

export async function runRendererSmokeChecks(window: BrowserWindow): Promise<void> {
  const rendererResult = (await window.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const deadline = Date.now() + 10000;
          const check = async () => {
            try {
              const root = document.getElementById("root");
              if (window.piBridge && root && root.childElementCount > 0) {
                const findButton = (text) => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
                const findLabeledButton = (...labels) => Array.from(document.querySelectorAll("button")).find((button) => labels.includes(button.getAttribute("aria-label") || ""));
                const waitForElement = async (find, failure) => {
                  const elementDeadline = Date.now() + 3000;
                  while (Date.now() < elementDeadline) {
                    const element = find();
                    if (element) return element;
                    await new Promise((wait) => setTimeout(wait, 25));
                  }
                  throw new Error(failure);
                };
                const settingsButton = document.querySelector('button[title="Settings"],button[title="设置"]');
                if (!settingsButton) {
                  if (Date.now() >= deadline) throw new Error("Settings button is unavailable");
                  setTimeout(check, 50);
                  return;
                }
                settingsButton.click();
                const settingsDeadline = Date.now() + 3000;
                let chatFontSizeSelect;
                let chatLayoutSelect;
                while ((!chatFontSizeSelect || !chatLayoutSelect) && Date.now() < settingsDeadline) {
                  const labels = Array.from(document.querySelectorAll("label"));
                  const fontLabel = labels.find((label) => ["Chat text size", "聊天字号"].includes(label.textContent?.trim() || ""));
                  const layoutLabel = labels.find((label) => ["Conversation width", "对话宽度"].includes(label.textContent?.trim() || ""));
                  chatFontSizeSelect = fontLabel?.htmlFor ? document.getElementById(fontLabel.htmlFor) : undefined;
                  chatLayoutSelect = layoutLabel?.htmlFor ? document.getElementById(layoutLabel.htmlFor) : undefined;
                  if (!chatFontSizeSelect || !chatLayoutSelect) {
                    await new Promise((wait) => setTimeout(wait, 25));
                  }
                }
                if (!(chatFontSizeSelect instanceof HTMLSelectElement) || !(chatLayoutSelect instanceof HTMLSelectElement)) {
                  throw new Error("Chat appearance settings are unavailable or unlabeled");
                }
                const expectedFontOptions = ["small", "standard", "large", "extra-large"];
                const expectedLayoutOptions = ["fixed", "wide"];
                if (JSON.stringify(Array.from(chatFontSizeSelect.options, (option) => option.value)) !== JSON.stringify(expectedFontOptions)) {
                  throw new Error("Chat font-size options do not match the public contract");
                }
                if (JSON.stringify(Array.from(chatLayoutSelect.options, (option) => option.value)) !== JSON.stringify(expectedLayoutOptions)) {
                  throw new Error("Chat layout options do not match the public contract");
                }
                const chatFixture = document.createElement("div");
                chatFixture.className = "chat-appearance-scope";
                Object.assign(chatFixture.style, {
                  position: "absolute",
                  visibility: "hidden",
                  width: "100%",
                  pointerEvents: "none",
                });
                const chatColumn = document.createElement("div");
                chatColumn.className = "chat-content-column";
                const readingText = document.createElement("div");
                readingText.className = "chat-reading";
                readingText.style.fontSize = "calc(14px * var(--type-scale, 1))";
                readingText.textContent = "message";
                const composerText = document.createElement("textarea");
                composerText.className = "type-chat-input";
                chatColumn.append(readingText, composerText);
                chatFixture.appendChild(chatColumn);
                document.body.appendChild(chatFixture);
                const chatScope = chatFixture;
                const changeSelect = (select, value) => {
                  const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
                  valueSetter?.call(select, value);
                  select.dispatchEvent(new Event("change", { bubbles: true }));
                };
                const waitForAppearance = async (fontSize, layout) => {
                  const appearanceDeadline = Date.now() + 3000;
                  while (Date.now() < appearanceDeadline) {
                    const state = await window.piBridge.getUiState();
                    if (
                      document.documentElement.dataset.chatFontSize === fontSize &&
                      document.documentElement.dataset.chatLayout === layout &&
                      state.chatAppearance?.fontSize === fontSize &&
                      state.chatAppearance?.layout === layout &&
                      !chatFontSizeSelect.disabled &&
                      !chatLayoutSelect.disabled
                    ) {
                      return;
                    }
                    await new Promise((wait) => setTimeout(wait, 25));
                  }
                  throw new Error("Chat appearance did not apply and persist before the deadline");
                };
                changeSelect(chatFontSizeSelect, "standard");
                await waitForAppearance("standard", chatLayoutSelect.value);
                changeSelect(chatLayoutSelect, "fixed");
                await waitForAppearance("standard", "fixed");
                const standardReadingFontSize = Number.parseFloat(getComputedStyle(readingText).fontSize);
                const standardComposerFontSize = Number.parseFloat(getComputedStyle(composerText).fontSize);
                const settingsFontSize = getComputedStyle(chatFontSizeSelect).fontSize;
                const fixedColumnWidth = chatColumn.getBoundingClientRect().width;
                changeSelect(chatFontSizeSelect, "extra-large");
                await waitForAppearance("extra-large", "fixed");
                changeSelect(chatLayoutSelect, "wide");
                await waitForAppearance("extra-large", "wide");
                const extraLargeReadingFontSize = Number.parseFloat(getComputedStyle(readingText).fontSize);
                const extraLargeComposerFontSize = Number.parseFloat(getComputedStyle(composerText).fontSize);
                const wideColumnWidth = chatColumn.getBoundingClientRect().width;
                window.resizeTo(900, 700);
                await new Promise((wait) => setTimeout(wait, 50));
                const narrowLayout =
                  document.documentElement.clientWidth <= 900 &&
                  document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
                  chatColumn.getBoundingClientRect().width <= chatScope.getBoundingClientRect().width;
                window.resizeTo(1440, 900);
                await new Promise((wait) => setTimeout(wait, 50));
                const chatAppearance =
                  Math.abs(extraLargeReadingFontSize / standardReadingFontSize - 1.3) < 0.01 &&
                  extraLargeComposerFontSize === standardComposerFontSize &&
                  fixedColumnWidth <= 760.5 &&
                  wideColumnWidth > 760.5 &&
                  wideColumnWidth <= 960.5 &&
                  wideColumnWidth > fixedColumnWidth &&
                  narrowLayout &&
                  getComputedStyle(chatFontSizeSelect).fontSize === settingsFontSize &&
                  document.documentElement.scrollWidth <= document.documentElement.clientWidth;
                chatFixture.remove();
                changeSelect(chatFontSizeSelect, "standard");
                await waitForAppearance("standard", "wide");
                changeSelect(chatLayoutSelect, "fixed");
                await waitForAppearance("standard", "fixed");
                (await waitForElement(() => findLabeledButton("Plugins & Skills", "插件与技能"), "Plugins & Skills navigation is unavailable")).click();
                (await waitForElement(() => findLabeledButton("Remote chat", "远程对话"), "Remote chat entry is unavailable")).click();
                (await waitForElement(() => findButton("Add chat app") || findButton("接入新应用"), "Remote chat app menu is unavailable")).click();
                const channelDeadline = Date.now() + 3000;
                let weixinConnectButton;
                let telegramConnectButton;
                while ((!weixinConnectButton || !telegramConnectButton) && Date.now() < channelDeadline) {
                  weixinConnectButton = findButton("Connect WeChat") || findButton("连接微信");
                  telegramConnectButton = findButton("Connect Telegram") || findButton("连接 Telegram");
                  if (!weixinConnectButton || !telegramConnectButton) await new Promise((wait) => setTimeout(wait, 25));
                }
                if (!weixinConnectButton) throw new Error("WeChat settings UI is unavailable");
                if (!telegramConnectButton) throw new Error("Telegram settings UI is unavailable");
                if (typeof window.piBridge.setChannelCredential !== "function") {
                  throw new Error("Write-only channel credential bridge is unavailable");
                }
                const activityLog = document.querySelector('[data-testid="channel-activity-log"]');
                if (!activityLog || activityLog.getClientRects().length === 0) {
                  throw new Error("Recent channel activity log is not shown");
                }
                const status = await fetch(${JSON.stringify(`/api/git-status?cwd=${encodeURIComponent(process.cwd())}`)}).then((response) => response.json());
                const token = "pi-html-preview-smoke-" + Math.random().toString(36).slice(2);
                const previewUrl = await window.piBridge.createHtmlPreview(
                  "<!doctype html><img id='asset' src='./icon.png'><script>addEventListener('load',()=>{if(asset.naturalWidth)parent.postMessage(" + JSON.stringify(token) + ",'*')})<\\/script>",
                  ${JSON.stringify(path.join(process.cwd(), "build", "smoke.html"))},
                );
                const previewRendered = await new Promise((previewResolve, previewReject) => {
                  const frame = document.createElement("iframe");
                  frame.sandbox = "allow-scripts";
                  frame.style.display = "none";
                  const previewTimer = setTimeout(() => {
                    cleanup();
                    previewReject(new Error("Sandboxed HTML preview did not execute"));
                  }, 3000);
                  const onMessage = (event) => {
                    if (event.data !== token) return;
                    cleanup();
                    previewResolve(true);
                  };
                  const cleanup = () => {
                    clearTimeout(previewTimer);
                    window.removeEventListener("message", onMessage);
                    frame.remove();
                    void window.piBridge.releaseHtmlPreview(previewUrl);
                  };
                  window.addEventListener("message", onMessage);
                  frame.src = previewUrl;
                  document.body.appendChild(frame);
                });
                resolve({
                  bridge: typeof window.piBridge.saveBinaryFile === "function",
                  rendered: root.childElementCount > 0,
                  gitStatus: typeof status.isGit === "boolean",
                  htmlPreview: previewRendered,
                  chatAppearance,
                  channelSettings: Boolean(weixinConnectButton && telegramConnectButton),
                  channelCredentialWrite: typeof window.piBridge.setChannelCredential === "function",
                });
                return;
              }
            } catch (error) {
              reject(error);
              return;
            }
            if (Date.now() >= deadline) reject(new Error("Renderer did not become ready"));
            else setTimeout(check, 50);
          };
          void check();
        })
      `)) as {
    bridge?: boolean;
    rendered?: boolean;
    gitStatus?: boolean;
    htmlPreview?: boolean;
    chatAppearance?: boolean;
    channelSettings?: boolean;
    channelCredentialWrite?: boolean;
  };
  if (
    !rendererResult.bridge ||
    !rendererResult.rendered ||
    !rendererResult.gitStatus ||
    !rendererResult.htmlPreview ||
    !rendererResult.chatAppearance ||
    !rendererResult.channelSettings ||
    !rendererResult.channelCredentialWrite
  ) {
    throw new Error(`Renderer smoke returned invalid result: ${JSON.stringify(rendererResult)}`);
  }
}

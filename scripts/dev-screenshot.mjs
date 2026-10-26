#!/usr/bin/env node
/**
 * Captures screenshots of a running dev app (started with DEXON_DEV_DEBUG_PORT)
 * through the Chrome DevTools protocol. Used to compare real screens with the
 * Framer snapshot during the redesign.
 *
 *   node scripts/dev-screenshot.mjs --port 9333 --out .artifacts/redesign/real \
 *     --theme light --eval 'document.querySelector("[data-nav-entry=settings]")?.click()' --name settings
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const port = Number(argument("port", process.env.DEXON_DEV_DEBUG_PORT ?? 9333));
const out = path.resolve(argument("out", ".artifacts/redesign/real"));
const name = argument("name", "screen");
const theme = argument("theme");
const script = argument("eval");
const settleMs = Number(argument("settle", 800));

const targets = await (await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((target) => target.type === "page" && /^(http:\/\/localhost|app:)/.test(target.url));
if (!page) throw new Error(`no app page on debug port ${port}`);

const socket = new globalThis.WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};

if (theme) {
  await evaluate(
    `document.documentElement.classList.toggle("dark", ${JSON.stringify(theme)} === "dark"); document.documentElement.style.colorScheme = ${JSON.stringify(theme)};`,
  );
}
if (script) await evaluate(script);
await new Promise((resolve) => setTimeout(resolve, settleMs));
const { data } = await send("Page.captureScreenshot", { format: "png" });
mkdirSync(out, { recursive: true });
const file = path.join(out, `${name}${theme ? `-${theme}` : ""}.png`);
writeFileSync(file, Buffer.from(data, "base64"));
socket.close();
console.log(file);

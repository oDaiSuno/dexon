import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { until } from "./fixture.mjs";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
export async function loopback() {
  const requests = [];
  const handlers = new Map();
  const held = new Set();
  const errors = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const entry = { atMs: Date.now(), method: request.method, url: request.url, headers: request.headers, body };
      requests.push(entry);
      const handler = handlers.get(request.url);
      try {
        if (handler) handler(entry, response);
        else {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: true, ret: 0 }));
        }
      } catch (error) {
        errors.push(error);
        response.writeHead(500);
        response.end("Boundary assertion failed");
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    handlers,
    errors,
    hold(url) {
      const responses = new Set();
      handlers.set(url, (_entry, response) => {
        responses.add(response);
        held.add(response);
      });
      return {
        wait: () => until(() => requests.find((request) => request.url === url), `HTTP ${url}`),
        release() {
          handlers.delete(url);
          for (const response of responses) {
            response.writeHead(200, { "content-type": "application/json" });
            response.end('{"ok":true}');
            held.delete(response);
          }
          responses.clear();
        },
      };
    },
    wait: (url) => until(() => requests.find((request) => request.url === url), `HTTP ${url}`),
    safeLog() {
      return requests.map(({ atMs, method, url, headers, body }) => ({
        atMs,
        method,
        url,
        headerNames: Object.keys(headers),
        headerHashes: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, digest(String(value))])),
        bodySha256: digest(body),
      }));
    },
    async close() {
      for (const response of held) response.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      assert.deepEqual(errors, []);
    },
  };
}
export function configureModel(fixture, boundary) {
  const provider = "automation-loopback";
  const modelId = "automation-proof";
  writeFileSync(
    path.join(fixture.agent, "models.json"),
    JSON.stringify({
      providers: {
        [provider]: {
          baseUrl: `${boundary.origin}/v1`,
          api: "openai-completions",
          apiKey: "loopback-model-key",
          models: [
            {
              id: modelId,
              name: "Loopback automation",
              reasoning: false,
              input: ["text"],
              contextWindow: 8192,
              maxTokens: 1024,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    }),
  );
  writeFileSync(
    path.join(fixture.agent, "settings.json"),
    JSON.stringify({ defaultProvider: provider, defaultModel: modelId, retry: { enabled: false } }),
  );
  boundary.handlers.set("/v1/chat/completions", (entry, response) => {
    const body = JSON.parse(entry.body);
    assert.equal(body.model, modelId);
    assert.deepEqual(body.tools.map((tool) => tool.function.name).sort(), ["automation_result", "write"]);
    const toolMessages = body.messages.filter((message) => message.role === "tool");
    const submitted = body.messages.some((message) =>
      message.tool_calls?.some((call) => call.function.name === "automation_result"),
    );
    const name = toolMessages.length === 0 ? "write" : "automation_result";
    const input =
      name === "write"
        ? { path: "offline-proof.txt", content: "Real isolated automation workspace write\n" }
        : { proved: true };
    const delta = submitted
      ? { role: "assistant", content: "Done" }
      : {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `proof-${boundary.requests.length}`,
              type: "function",
              function: { name, arguments: JSON.stringify(input) },
            },
          ],
        };
    const chunk = (value, finishReason = null) =>
      `data: ${JSON.stringify({ id: "automation-proof", object: "chat.completion.chunk", model: modelId, choices: [{ index: 0, delta: value, finish_reason: finishReason }] })}\n\n`;
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.end(`${chunk(delta)}${chunk({}, submitted ? "stop" : "tool_calls")}data: [DONE]\n\n`);
  });
  return { provider, modelId };
}
export function configureWeixin(fixture, boundary) {
  writeFileSync(
    path.join(fixture.stateDir, "channels.json"),
    JSON.stringify({
      version: 1,
      accounts: [
        {
          id: "loopback-weixin",
          channel: "weixin",
          name: "Loopback Weixin",
          enabled: true,
          providerAccountId: "loopback-bot",
          dmPolicy: "disabled",
          groupPolicy: "disabled",
          toolNames: [],
          baseUrl: boundary.origin,
        },
      ],
      bindings: [],
    }),
  );
  writeFileSync(
    path.join(fixture.stateDir, "channels.secrets.json"),
    JSON.stringify({
      "channel:weixin:loopback-weixin": {
        token: "loopback-channel-token",
        providerAccountId: "loopback-bot",
        baseUrl: boundary.origin,
      },
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(fixture.stateDir, "channels.state.json"),
    JSON.stringify({ version: 1, contextTokens: { "loopback-weixin\u0000peer-proof": "loopback-context" } }),
  );
  boundary.hold("/ilink/bot/getupdates");
  boundary.handlers.set("/ilink/bot/sendmessage", (entry, response) => {
    assert.equal(entry.headers.authorization, "Bearer loopback-channel-token");
    assert.equal(entry.headers.authorizationtype, "ilink_bot_token");
    const body = JSON.parse(entry.body);
    assert.equal(body.msg.to_user_id, "peer-proof");
    assert.equal(body.msg.context_token, "loopback-context");
    assert.equal(body.msg.item_list[0].text_item.text, "Offline channel proof");
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ret":0}');
  });
}

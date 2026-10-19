import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createDeferred } from "#test-timing";

export const heldModel = { provider: "held-fixture", modelId: "held-model" };

function chunk(delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: "held-fixture",
    object: "chat.completion.chunk",
    model: heldModel.modelId,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function promptText(body) {
  try {
    const messages = JSON.parse(body).messages ?? [];
    return messages
      .filter((message) => message.role === "user")
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : (message.content ?? []).map((part) => part.text ?? "").join(""),
      )
      .join("\n");
  } catch {
    return "";
  }
}

export async function startHeldModelServer({ otherReply = "Held fixture title" } = {}) {
  const replies = new Map();
  const sockets = new Set();
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (part) => (body += part));
    request.on("end", async () => {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const text = promptText(body);
      const reply = [...replies.values()].find((entry) => !entry.used && text.includes(entry.prompt));
      if (!reply) {
        response.end(`${chunk({ role: "assistant", content: otherReply })}${chunk({}, "stop")}data: [DONE]\n\n`);
        return;
      }
      reply.used = true;
      response.write(chunk({ role: "assistant", content: reply.partial }));
      reply.partialSent.resolve();
      await reply.released.promise;
      response.end(`${chunk({ content: reply.rest })}${chunk({}, "stop")}data: [DONE]\n\n`);
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  return {
    baseUrl,
    hold(prompt, { partial, rest }) {
      const entry = { prompt, partial, rest, used: false, partialSent: createDeferred(), released: createDeferred() };
      replies.set(prompt, entry);
      return {
        partialSent: () => entry.partialSent.promise,
        release: () => entry.released.resolve(),
      };
    },
    configure(agentDirectory) {
      writeFileSync(
        path.join(agentDirectory, "models.json"),
        JSON.stringify({
          providers: {
            [heldModel.provider]: {
              baseUrl,
              api: "openai-completions",
              apiKey: "held-fixture-key",
              models: [
                {
                  id: heldModel.modelId,
                  name: "Held fixture model",
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
        path.join(agentDirectory, "settings.json"),
        JSON.stringify({ defaultProvider: heldModel.provider, defaultModel: heldModel.modelId }),
      );
    },
    async close() {
      for (const entry of replies.values()) entry.released.resolve();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

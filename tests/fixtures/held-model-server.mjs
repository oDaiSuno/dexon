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

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  return (message?.content ?? []).map((part) => part?.text ?? "").join("");
}

function parsedBody(body) {
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function firstUserText(messages) {
  return messageText(messages.find((message) => message.role === "user"));
}

function heldStep({ partial, rest }) {
  return { partial, rest, partialSent: createDeferred(), released: createDeferred() };
}

export async function startHeldModelServer({ otherReply = "Held fixture title" } = {}) {
  const scripts = [];
  const requests = [];
  const toolResults = [];
  const resultsSeen = new Set();
  const sockets = new Set();
  let resultsWaiter = null;

  const settleResultsWaiter = () => {
    if (resultsWaiter && toolResults.length >= resultsWaiter.count) {
      const waiter = resultsWaiter;
      resultsWaiter = null;
      waiter.deferred.resolve([...toolResults]);
    }
  };

  const record = (messages, tools) => {
    const names = new Map();
    for (const message of messages) {
      for (const call of message.tool_calls ?? []) names.set(call.id, call.function?.name ?? "");
    }
    for (const message of messages) {
      if (message.role !== "tool" || resultsSeen.has(message.tool_call_id)) continue;
      resultsSeen.add(message.tool_call_id);
      toolResults.push({
        name: names.get(message.tool_call_id) ?? "",
        toolCallId: message.tool_call_id,
        content: messageText(message),
      });
    }
    requests.push({ messages, tools });
    settleResultsWaiter();
  };

  const pickScript = (messages) => {
    const first = firstUserText(messages);
    return scripts.find((script) => script.index < script.steps.length && first.includes(script.prompt)) ?? null;
  };

  const respond = async (response, step, scriptIndex, stepIndex) => {
    if (step.error) {
      response.writeHead(step.error.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: step.error.message } }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    if (step.thinking) {
      response.write(chunk({ role: "assistant", content: "" }));
      response.write(chunk({ reasoning_content: step.thinking }));
    }
    const requested = step.toolCalls ?? (step.toolCall ? [step.toolCall] : []);
    if (requested.length > 0) {
      response.write(chunk({ role: "assistant", content: "" }));
      response.write(
        chunk({
          tool_calls: requested.map((call, index) => ({
            index,
            id: call.id ?? `call-${scriptIndex}-${stepIndex}-${index}`,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(typeof call.input === "function" ? call.input() : (call.input ?? {})),
            },
          })),
        }),
      );
      response.end(`${chunk({}, "tool_calls")}data: [DONE]\n\n`);
      return;
    }
    if (step.released) {
      response.write(chunk({ role: "assistant", content: step.partial }));
      step.partialSent.resolve();
      await step.released.promise;
      response.end(`${chunk({ content: step.rest })}${chunk({}, "stop")}data: [DONE]\n\n`);
      return;
    }
    response.end(`${chunk({ role: "assistant", content: step.text })}${chunk({}, "stop")}data: [DONE]\n\n`);
  };

  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (part) => (body += part));
    request.on("end", () => {
      const parsed = parsedBody(body);
      const messages = parsed.messages ?? [];
      record(messages, parsed.tools);
      const script = pickScript(messages);
      if (!script) {
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        response.end(`${chunk({ role: "assistant", content: otherReply })}${chunk({}, "stop")}data: [DONE]\n\n`);
        return;
      }
      const scriptIndex = scripts.indexOf(script);
      const stepIndex = script.index;
      const step = script.steps[script.index++];
      respond(response, step, scriptIndex, stepIndex).catch(() => response.end());
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
      const step = heldStep({ partial, rest });
      scripts.push({ prompt, steps: [step], index: 0 });
      return {
        partialSent: () => step.partialSent.promise,
        release: () => step.released.resolve(),
      };
    },
    script(prompt, steps) {
      const normalized = steps.map((step) => (step.hold ? heldStep({ partial: step.partial, rest: step.rest }) : step));
      scripts.push({ prompt, steps: normalized, index: 0 });
      return {
        partialSent: (index) => normalized[index].partialSent.promise,
        release: (index) => normalized[index].released.resolve(),
        releaseAll: () => {
          for (const step of normalized) step.released?.resolve();
        },
      };
    },
    requests: () => [...requests],
    toolResults: () => [...toolResults],
    waitForToolResults(count, timeoutMs = 30_000) {
      if (toolResults.length >= count) return Promise.resolve([...toolResults]);
      const deferred = createDeferred();
      const timer = setTimeout(
        () => deferred.reject(new Error(`Only ${toolResults.length} of ${count} tool results arrived`)),
        timeoutMs,
      );
      resultsWaiter = { count, deferred };
      return deferred.promise.finally(() => clearTimeout(timer));
    },
    configure(agentDirectory, { models = [{ id: heldModel.modelId, reasoning: false }], retry } = {}) {
      writeFileSync(
        path.join(agentDirectory, "models.json"),
        JSON.stringify({
          providers: {
            [heldModel.provider]: {
              baseUrl,
              api: "openai-completions",
              apiKey: "held-fixture-key",
              models: models.map((model) => ({
                id: model.id,
                name: `Held fixture model ${model.id}`,
                reasoning: model.reasoning === true,
                input: ["text"],
                contextWindow: 8192,
                maxTokens: 1024,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              })),
            },
          },
        }),
      );
      writeFileSync(
        path.join(agentDirectory, "settings.json"),
        JSON.stringify({
          defaultProvider: heldModel.provider,
          defaultModel: heldModel.modelId,
          ...(retry === false ? { retry: { enabled: false } } : {}),
        }),
      );
    },
    async close() {
      for (const script of scripts) for (const step of script.steps) step.released?.resolve();
      resultsWaiter?.deferred.reject(new Error("Model fixture closed before every tool result arrived"));
      resultsWaiter = null;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

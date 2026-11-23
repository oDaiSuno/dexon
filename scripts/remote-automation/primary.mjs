import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { MessageChannel, Worker } from "node:worker_threads";
import { createRpcClient } from "../../src/contract/rpc.ts";
import { isAutomationSecretName, isAutomationSecretValue } from "../../src/shared/automation/secret-name.ts";
import { isolatedDirectory, until } from "./fixture.mjs";
import { electronPort } from "./ports.mjs";

function primaryVault(file) {
  const key = randomBytes(32);
  const read = () => {
    if (!existsSync(file)) return {};
    const { iv, tag, ciphertext } = JSON.parse(readFileSync(file, "utf8"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString());
  };
  const write = (values) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values)), cipher.final()]);
    writeFileSync(
      file,
      JSON.stringify({
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      }),
      { mode: 0o600 },
    );
  };
  const validName = (name) => assert.equal(isAutomationSecretName(name), true);
  return {
    setAutomationSecret(name, value) {
      validName(name);
      assert.equal(isAutomationSecretValue(value), true);
      write({ ...read(), [name]: value });
    },
    deleteAutomationSecret(name) {
      validName(name);
      const values = read();
      delete values[name];
      write(values);
    },
    listAutomationSecretNames() {
      return Object.keys(read()).sort();
    },
    get(name) {
      validName(name);
      return read()[name] ?? null;
    },
  };
}
export async function primaryHost() {
  const dirs = isolatedDirectory("e4-primary");
  const vault = primaryVault(path.join(dirs.directory, "primary-vault.json"));
  const worker = new Worker(new URL("./primary-worker.mjs", import.meta.url), {
    env: dirs.env,
    stdout: true,
    stderr: true,
  });
  const responses = [];
  const ports = [];
  let ready = false;
  let serving = true;
  let exited = false;
  let failure;
  let logs = "";
  worker.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  worker.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  worker.on("error", (error) => {
    failure = error;
  });
  worker.on("exit", () => {
    exited = true;
    serving = false;
  });
  worker.on("message", (message) => {
    if (message.type === "ready") ready = true;
    if (message.type === "host-rpc") {
      const { id, method, params } = message;
      let result;
      let error;
      if (method === "automationSecrets.get") result = vault.get(params.name);
      else if (method === "channelSecrets.get") result = null;
      else if (method === "sessionOrchestration.getSettings")
        result = { enabled: false, maxRunning: 8, model: null, thinkingLevel: null, allowUserSessions: true };
      else error = { message: `Primary boundary does not support ${method}` };
      worker.postMessage({ data: { type: "host-rpc-result", id, ok: !error, result, error } });
    }
  });
  const channel = (audience) => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1);
    port1.on("message", (message) => responses.push(message));
    worker.postMessage({ data: { type: "attach-port", audience }, ports: [port2] }, [port2]);
    return port1;
  };
  const dispose = async () => {
    for (const port of ports) port.close();
    try {
      if (!exited) {
        worker.postMessage({ data: { type: "shutdown" } });
        await until(() => exited, "real primary Host shutdown", 15000);
      }
    } finally {
      if (!exited) await worker.terminate();
      rmSync(dirs.directory, { recursive: true, force: true });
    }
  };
  try {
    await until(() => {
      if (failure) throw failure;
      if (exited) throw new Error(logs);
      return ready;
    }, "real primary Host ready");
    const gatekeeper = createRpcClient(channel("gatekeeper"), { callTimeoutMs: 15000 });
    assert.equal((await gatekeeper.call("host.ping")).ok, true);
    const host = {
      generation: 1,
      getGeneration: () => 1,
      isServing: () => serving,
      getStatus: () => (serving ? "ready" : "stopped"),
      getReadySince: () => Date.now(),
      getPiVersion: () => "1.4.0",
      gatekeeperCall: (method, params) => gatekeeper.call(method, params),
      createRendererChannel() {
        return { port1: electronPort(channel("renderer")) };
      },
    };
    return { ...dirs, host, vault, rpc: gatekeeper, responses, log: () => logs, dispose };
  } catch (error) {
    console.error(logs);
    await dispose();
    throw error;
  }
}

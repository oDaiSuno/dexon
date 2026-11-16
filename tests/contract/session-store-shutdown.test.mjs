import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  expectToolPayload,
  resultReader,
  startSessionOrchestrationHost,
  toolCall,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({ name: "store-shutdown", settings: ENABLED_SETTINGS });
after(() => host.close());

test(
  "runtime shutdown persists pending projects, origins and journal removals before restarting",
  { timeout: 30_000 },
  async (t) => {
    const cwd = host.workspace("project");
    const parent = await host.createUserSession({ cwd });
    host.model.script("Create a durable worker", [
      toolCall("session_new", { message: "Durable worker", wait: true, timeoutSeconds: 20 }),
      { text: "Created" },
    ]);
    host.model.script("Durable worker", [{ text: "Saved" }]);
    const events = host.events(parent);
    const results = resultReader(host);
    const projectsPath = path.join(host.base, "desktop", "session-projects.json");
    const originsPath = path.join(host.base, "desktop", "session-origins.json");
    const journalPath = path.join(host.base, "desktop", "session-index.v2.jsonl");
    const schedule = setTimeout;
    t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) =>
      schedule(callback, delay === 500 ? 60_000 : delay, ...args),
    );
    try {
      await host.prompt(parent, "Create a durable worker");
      const child = expectToolPayload((await results.next())[0], "worker creation must complete").sessionId;
      await events.next((event) => event.type === "agent_end");
      const deletedPath = await host.writeSession("deleted-before-exit", cwd, []);
      await host.sessions();
      assert.equal(existsSync(projectsPath), false, "scanning sessions must not bypass the debounce");
      assert.equal(existsSync(originsPath), false, "origin changes are still waiting for the debounce");
      const append = fs.appendFile.bind(fs);
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      t.mock.method(fs, "appendFile", async (...args) => {
        if (args[0] === journalPath && String(args[1]).includes('"op":"del"')) {
          entered.resolve();
          await release.promise;
        }
        return append(...args);
      });
      await host.client.call("sessions.delete", { id: "deleted-before-exit" });
      await entered.promise;
      let stopped = false;
      const restarting = host.restart().then(() => {
        stopped = true;
      });
      try {
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(stopped, false, "shutdown waits for the queued deletion");
      } finally {
        release.resolve();
        await restarting;
      }
      const projects = JSON.parse(readFileSync(projectsPath, "utf8")).sessions;
      const origins = JSON.parse(readFileSync(originsPath, "utf8")).sessions;
      assert.equal(projects[parent].projectRoot, cwd);
      assert.equal(projects[child].projectRoot, cwd);
      assert.equal(origins[child].relation, "delegate");
      assert.equal(origins[child].createdBySessionId, parent);
      const journal = readFileSync(journalPath, "utf8").trim().split("\n").map(JSON.parse);
      assert.ok(journal.some((entry) => entry.op === "del" && entry.p === deletedPath));
      assert.equal((await host.sessionRow(child)).createdBySessionId, parent);
      assert.equal(await host.sessionRow("deleted-before-exit"), undefined);
    } finally {
      events.off();
    }
  },
);

test(
  "shutdown reports disk failures without rejecting and still flushes independent state",
  { timeout: 30_000 },
  async (t) => {
    const cwd = host.workspace("disk-failure");
    const parent = await host.createUserSession({ cwd });
    host.model.script("Create a worker before disk failure", [
      toolCall("session_new", { message: "Worker survives disk failure", wait: true, timeoutSeconds: 20 }),
      { text: "Created" },
    ]);
    host.model.script("Worker survives disk failure", [{ text: "Saved" }]);
    const events = host.events(parent);
    const results = resultReader(host);
    const schedule = setTimeout;
    t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) =>
      schedule(callback, delay === 500 ? 60_000 : delay, ...args),
    );
    try {
      await host.prompt(parent, "Create a worker before disk failure");
      const child = expectToolPayload((await results.next())[0], "worker creation must complete").sessionId;
      await events.next((event) => event.type === "agent_end");
      await host.writeSession("failed-removal", cwd, []);
      await host.sessions();
      const projectsPath = path.join(host.base, "desktop", "session-projects.json");
      const originsPath = path.join(host.base, "desktop", "session-origins.json");
      const journalPath = path.join(host.base, "desktop", "session-index.v2.jsonl");
      const append = fs.appendFile.bind(fs);
      const rename = fs.rename.bind(fs);
      const errors = [];
      t.mock.method(console, "error", (...args) => errors.push(args));
      t.mock.method(fs, "appendFile", async (...args) => {
        if (args[0] === journalPath) throw Object.assign(new Error("journal unavailable"), { code: "EACCES" });
        return append(...args);
      });
      t.mock.method(fs, "rename", async (...args) => {
        if (args[1] === projectsPath) throw Object.assign(new Error("projects unavailable"), { code: "EACCES" });
        return rename(...args);
      });
      await host.client.call("sessions.delete", { id: "failed-removal" });
      await assert.doesNotReject(host.restart());
      assert.ok(errors.some((entry) => entry.some((part) => part?.message === "journal unavailable")));
      assert.ok(errors.some((entry) => entry.some((part) => part?.message === "projects unavailable")));
      const origins = JSON.parse(readFileSync(originsPath, "utf8")).sessions;
      assert.equal(origins[child].createdBySessionId, parent, "an index or projects failure does not skip origins");
    } finally {
      events.off();
    }
  },
);

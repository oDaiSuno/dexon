import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { importTestBundle } from "#test-bundle";

const { AgentSessionWrapper } = await importTestBundle("slash-command-hints", {
  packages: "external",
  tsconfig: "tsconfig.renderer.json",
  stdin: {
    contents: 'export {AgentSessionWrapper} from "./src/agent-host/rpc-manager";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
});

async function sessionWithPrompts(t, prompts) {
  const base = mkdtempSync(path.join(tmpdir(), "dexon-slash-hints-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const cwd = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  const sessionDir = path.join(base, "sessions");
  for (const dir of [cwd, path.join(agentDir, "prompts"), sessionDir]) mkdirSync(dir, { recursive: true });
  for (const [name, source] of Object.entries(prompts))
    writeFileSync(path.join(agentDir, "prompts", `${name}.md`), source);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: { noSkills: true, noThemes: true, noContextFiles: true, noExtensions: true },
  });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.create(cwd, sessionDir),
  });
  const wrapper = new AgentSessionWrapper(session, undefined, () => {});
  wrapper.start();
  t.after(async () => {
    await wrapper.dispose();
    await session.dispose();
  });
  return wrapper;
}

test("a prompt template that declares an argument hint offers it in the command list, and one without a hint offers none", async (t) => {
  const wrapper = await sessionWithPrompts(t, {
    "review-pr": "---\ndescription: Review a pull request\nargument-hint: <pr-number>\n---\nReview PR $1\n",
    explain: "---\ndescription: Explain the selected code\n---\nExplain it\n",
  });
  const { commands } = await wrapper.send({ type: "get_commands" });
  const review = commands.find((command) => command.name === "review-pr");
  const explain = commands.find((command) => command.name === "explain");
  assert.equal(review?.source, "prompt");
  assert.equal(review.argumentHint, "<pr-number>");
  assert.equal(explain?.source, "prompt");
  assert.equal("argumentHint" in explain, false);
});

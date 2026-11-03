import assert from "node:assert/strict";
import test from "node:test";
import { updateRemoteTrustPrompts } from "./remote-trust-prompts.ts";

const processPrompt = {
  promptId: "process-prompt",
  workspace: "ssh://ubuntu@prod-vps/home/ubuntu/app",
  sessionId: "remote-session",
  status: "pending",
  kind: "process_start",
  command: "npm run dev",
  cwd: "/home/ubuntu/app",
  remoteHostLabel: "prod-vps",
  remoteSkillCount: 2,
};
const skillPrompt = {
  ...processPrompt,
  promptId: "skill-prompt",
  kind: "remote_skill",
  skillName: "deploy",
};

test("when a second trust request arrives resolving it leaves the first request available to answer", () => {
  let pending = updateRemoteTrustPrompts([], processPrompt);
  pending = updateRemoteTrustPrompts(pending, skillPrompt);
  pending = updateRemoteTrustPrompts(pending, { ...skillPrompt, status: "resolved" });

  assert.deepEqual(pending, [processPrompt]);
});

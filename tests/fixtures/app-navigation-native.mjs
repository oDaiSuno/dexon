import fs from "node:fs";
import path from "node:path";

export const nativeNavigationScenes = [
  "01-production-startup",
  "02-expanded-resources",
  "03-plugin-persistence",
  "04-skill-persistence",
  "05-resource-keyboard",
  "06-rail-layout-and-focus",
  "07-rail-settings",
  "08-new-chat-and-expand",
  "09-space-menu-keyboard",
  "10-minimum-window-width",
];

export const nativeHistoryTitle = "Production history before collapse";

export const nativeSkillInitial =
  "---\nname: production-checklist\ndescription: Check the production navigation.\n---\n\n# Production checklist\n\nRead the original fixture.\n";
export const nativeSkillSaved =
  "---\nname: production-checklist\ndescription: Check the production navigation.\n---\n\n# Production checklist\n\nSaved through the production application.\n";

export async function seedNativeNavigation() {
  const home = process.env.PI_DESKTOP_SMOKE_HOME;
  const agent = process.env.PI_CODING_AGENT_DIR;
  const sessions = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (
    !home ||
    home !== process.env.HOME ||
    !path.isAbsolute(home) ||
    !agent ||
    !path.isAbsolute(agent) ||
    !sessions ||
    !path.isAbsolute(sessions)
  ) {
    throw new Error("Production navigation requires disposable smoke home, Agent and session directories");
  }
  const personal = path.join(home, ".dexon");
  const packageDirectory = path.join(personal, "navigation-plugin");
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  // A local Pi package: no npm install, network credentials, or user config.
  write(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "production-navigation-plugin",
      version: "1.0.0",
      pi: { skills: ["skills"] },
    }),
  );
  write(
    path.join(packageDirectory, "skills", "packaged-checklist", "SKILL.md"),
    "---\nname: packaged-checklist\ndescription: A locally packaged fixture.\n---\n\n# Package checklist\n",
  );
  write(path.join(personal, ".pi", "settings.json"), JSON.stringify({ packages: [packageDirectory] }));
  write(path.join(personal, ".pi", "skills", "production-checklist", "SKILL.md"), nativeSkillInitial);
  write(
    path.join(agent, "skills", "shared-checklist", "SKILL.md"),
    "---\nname: shared-checklist\ndescription: Shared navigation fixture.\n---\n\n# Shared checklist\n",
  );
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const history = SessionManager.create(personal, sessions);
  history.appendMessage({ role: "user", content: "History exists before the rail is collapsed.", timestamp: 1 });
  history.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "The original conversation remains available after expansion." }],
    api: "openai-responses",
    provider: "navigation-fixture",
    model: "offline-history",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 2,
  });
  history.appendSessionInfo(nativeHistoryTitle);
  return { personal, packageDirectory };
}

import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function configuredSessionDir(): string | undefined {
  const directory = process.env.PI_CODING_AGENT_SESSION_DIR;
  return directory ? path.resolve(directory) : undefined;
}

export function sessionsRoot(agentDir = getAgentDir()): string {
  return configuredSessionDir() ?? path.resolve(agentDir, "sessions");
}

import { globSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { SshHostDiscovery, DiscoveredSshHost } from "../../contract/environment-commands.ts";
import type { StoredEnvironment } from "./environment-store.ts";
import { runLocalSshTool } from "./ssh-command.ts";
import { parseSshConfig, parseSshG } from "./ssh-config-parse.ts";
export async function discoverSshHosts(
  environments: readonly StoredEnvironment[],
  configPath = path.join(homedir(), ".ssh", "config"),
): Promise<SshHostDiscovery> {
  const sources = new Map<string, string>();
  const visited = new Set<string>();
  const walk = (file: string, depth: number) => {
    if (depth > 10 || visited.size >= 100) return;
    let canonical: string;
    try {
      canonical = realpathSync(file);
    } catch {
      return;
    }
    if (visited.has(canonical)) return;
    visited.add(canonical);
    if (statSync(canonical).size > 1_048_576) throw new Error("SSH config is too large");
    const parsed = parseSshConfig(readFileSync(canonical, "utf8"));
    for (const alias of parsed.hosts) if (!sources.has(alias)) sources.set(alias, canonical);
    for (const pattern of parsed.includes) {
      const expanded = pattern.startsWith("~/")
        ? path.join(homedir(), pattern.slice(2))
        : path.isAbsolute(pattern)
          ? pattern
          : path.join(homedir(), ".ssh", pattern);
      for (const match of globSync(expanded.replaceAll("\\", "/"))) walk(match, depth + 1);
    }
  };
  try {
    walk(configPath, 0);
    const entries = [...sources.entries()].slice(0, 100);
    const hosts: DiscoveredSshHost[] = [];
    const errors: string[] = [];
    for (let i = 0; i < entries.length; i += 4) {
      await Promise.all(
        entries.slice(i, i + 4).map(async ([alias, sourceFile]) => {
          try {
            const resolved = parseSshG(await runLocalSshTool("ssh", ["-G", "-F", configPath, alias]));
            const addedAs =
              environments.find(
                (environment) => environment.target.kind === "ssh" && environment.target.sshAlias === alias,
              )?.id ?? null;
            hosts.push({ alias, ...resolved, sourceFile, addedAs });
          } catch (error) {
            errors.push(`${alias}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }),
      );
    }
    hosts.sort((a, b) => a.alias.localeCompare(b.alias));
    return { configPath, hosts, error: errors.length ? errors.join("\n") : null };
  } catch (error) {
    return { configPath, hosts: [], error: error instanceof Error ? error.message : String(error) };
  }
}

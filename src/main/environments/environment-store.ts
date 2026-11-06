import { DEFAULT_LIFECYCLE_POLICY, type LifecyclePolicy } from "../../contract/environment-commands.ts";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AddEnvironmentInput,
  SshEnvironmentTarget,
  WebSocketEnvironmentTarget,
} from "../../contract/environment.ts";
import { readOrCreatePrivateFile, writePrivateJson } from "../../shared/private-state-file.ts";
import { resolveWebSocketTarget } from "./remote-endpoint.ts";
import { validateSshTarget } from "./ssh-scripts.ts";

export interface StoredEnvironment {
  id: string;
  label: string;
  target: SshEnvironmentTarget | WebSocketEnvironmentTarget;
  authToken?: string;
  enabled: boolean;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid environment configuration");
  return value as Record<string, unknown>;
}

export function parseAddEnvironmentInput(input: unknown): AddEnvironmentInput {
  const value = record(input);
  if (
    typeof value.label !== "string" ||
    !value.label.trim() ||
    value.label.length > 256 ||
    /[\0\r\n]/u.test(value.label)
  )
    throw new Error("Invalid environment label");
  if (value.enabled !== undefined && typeof value.enabled !== "boolean")
    throw new Error("Invalid environment enabled flag");
  if (
    value.authToken !== undefined &&
    (typeof value.authToken !== "string" ||
      !value.authToken.trim() ||
      value.authToken.length > 4096 ||
      /[\0\r\n]/u.test(value.authToken))
  )
    throw new Error("Invalid environment auth token");
  const target = record(value.target);
  if (
    target.expectedEnvironmentId !== undefined &&
    (typeof target.expectedEnvironmentId !== "string" ||
      !target.expectedEnvironmentId ||
      target.expectedEnvironmentId === "primary" ||
      target.expectedEnvironmentId.length > 1024 ||
      /[\0\r\n]/u.test(target.expectedEnvironmentId))
  )
    throw new Error("Invalid expected environment identity");
  const expectedEnvironmentId = target.expectedEnvironmentId as string | undefined;
  const authToken = typeof value.authToken === "string" ? value.authToken.trim() : undefined;
  let parsedTarget: SshEnvironmentTarget | WebSocketEnvironmentTarget;
  if (target.kind === "ssh") {
    if (
      typeof target.sshAlias !== "string" ||
      ["hostname", "user", "remoteStateDir"].some(
        (key) => target[key] !== undefined && typeof target[key] !== "string",
      ) ||
      ["port", "remotePort"].some((key) => target[key] !== undefined && typeof target[key] !== "number")
    )
      throw new Error("Invalid SSH target");
    parsedTarget = {
      kind: "ssh",
      sshAlias: target.sshAlias,
      hostname: target.hostname as string | undefined,
      user: target.user as string | undefined,
      port: target.port as number | undefined,
      remotePort: target.remotePort as number | undefined,
      remoteStateDir: target.remoteStateDir as string | undefined,
      expectedEnvironmentId,
    };
    validateSshTarget(parsedTarget);
  } else if (target.kind === "websocket" && typeof target.url === "string" && target.url.length <= 4096) {
    parsedTarget = { kind: "websocket", url: target.url, expectedEnvironmentId };
    const endpoint = resolveWebSocketTarget(parsedTarget, authToken);
    parsedTarget.url = endpoint.wsUrl;
  } else {
    throw new Error("Invalid environment target");
  }
  return {
    label: value.label.trim(),
    target: parsedTarget,
    authToken,
    enabled: value.enabled === undefined ? true : (value.enabled as boolean),
  };
}

export class EnvironmentStore {
  private readonly filePath: string;
  policy: LifecyclePolicy = { ...DEFAULT_LIFECYCLE_POLICY };

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, "environments.json");
  }

  load(): StoredEnvironment[] {
    const stored = record(
      JSON.parse(readOrCreatePrivateFile(this.filePath, JSON.stringify({ version: 1, environments: [] }))) as unknown,
    );
    if (stored.version !== 1 || !Array.isArray(stored.environments) || stored.environments.length > 100)
      throw new Error("Invalid persisted environments file");
    if (stored.policy !== undefined) {
      const policy = record(stored.policy);
      if (
        Object.keys(policy).some((key) => !["detachedDaemon", "autoReconnect"].includes(key)) ||
        Object.values(policy).some((value) => typeof value !== "boolean")
      )
        throw new Error("Invalid persisted environment policy");
      this.policy = { ...DEFAULT_LIFECYCLE_POLICY, ...policy };
    }
    const ids = new Set<string>();
    return stored.environments.map((entry: unknown) => {
      const value = record(entry);
      if (
        typeof value.id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value.id) ||
        ids.has(value.id)
      )
        throw new Error("Invalid persisted environment ID");
      ids.add(value.id);
      return { ...parseAddEnvironmentInput(value), id: value.id, enabled: value.enabled !== false };
    });
  }

  create(input: unknown): StoredEnvironment {
    const parsed = parseAddEnvironmentInput(input);
    return { ...parsed, id: randomUUID(), enabled: parsed.enabled !== false };
  }

  save(environments: StoredEnvironment[], policy: LifecyclePolicy = this.policy): void {
    writePrivateJson(this.filePath, { version: 1, environments, policy });
    this.policy = { ...policy };
  }
}

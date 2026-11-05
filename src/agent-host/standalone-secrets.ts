import { readFileSync } from "node:fs";
import { readOrCreatePrivateFile, writePrivateJson } from "./private-state-file.ts";

export class StandaloneSecretStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    readOrCreatePrivateFile(filePath, "{}");
    this.read();
  }

  private read(): Record<string, unknown> {
    const value: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid channel secret file");
    return value as Record<string, unknown>;
  }

  async handle(method: string, params: unknown): Promise<unknown> {
    const body = params as { key?: unknown; value?: unknown } | undefined;
    if (typeof body?.key !== "string" || !/^channel:(weixin|telegram|feishu):[a-z0-9._-]{1,160}$/iu.test(body.key)) {
      throw new Error("Invalid channel credential key");
    }
    const key = body.key;
    const values = this.read();
    if (method === "channelSecrets.get") {
      if (Object.hasOwn(values, key)) return values[key];
      const fallback = process.env[key] ?? process.env[key.replace(/[^a-z0-9]/giu, "_").toUpperCase()];
      if (fallback === undefined) return null;
      try {
        return JSON.parse(fallback) as unknown;
      } catch {
        return fallback;
      }
    }
    if (method === "channelSecrets.set") {
      if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
        throw new Error("Credential value is required");
      }
      values[key] = body.value;
    } else if (method === "channelSecrets.delete") {
      delete values[key];
    } else {
      throw new Error(`Unsupported Host request: ${method}`);
    }
    writePrivateJson(this.filePath, values);
    return { ok: true };
  }
}

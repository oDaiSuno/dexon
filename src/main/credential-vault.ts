import { safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
type VaultFile = {
  version: 1;
  entries: Record<string, string>;
};
const CHANNEL_KEY = /^channel:(weixin|telegram|feishu):[a-z0-9._-]{1,160}$/i;
const AUTOMATION_KEY = /^automation:secret:[a-z0-9._-]{1,80}$/;
function validateKey(key: string): string {
  if (typeof key !== "string" || (!CHANNEL_KEY.test(key) && !AUTOMATION_KEY.test(key)))
    throw new Error("Invalid credential key");
  return key;
}
export function automationSecretKey(name: unknown): string {
  if (typeof name !== "string" || !AUTOMATION_KEY.test(`automation:secret:${name}`))
    throw new Error("Invalid automation secret name");
  return `automation:secret:${name}`;
}
export class CredentialVault {
  constructor(private readonly filePath: string) {}
  private read(): VaultFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<VaultFile>;
      if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") {
        throw new Error("Invalid credential vault format");
      }
      return { version: 1, entries: parsed.entries };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: {} };
      throw error;
    }
  }
  private write(data: VaultFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, this.filePath);
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {}
  }
  private assertAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS credential encryption is unavailable; channel credentials were not persisted");
    }
  }
  get(key: string): Record<string, unknown> | null {
    this.assertAvailable();
    const encrypted = this.read().entries[validateKey(key)];
    if (!encrypted) return null;
    const plaintext = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Invalid channel credential payload");
    return parsed as Record<string, unknown>;
  }
  set(key: string, value: Record<string, unknown>): void {
    this.assertAvailable();
    const data = this.read();
    const encrypted = safeStorage.encryptString(JSON.stringify(value));
    data.entries[validateKey(key)] = encrypted.toString("base64");
    this.write(data);
  }
  setAutomationSecret(name: unknown, value: unknown): void {
    const key = automationSecretKey(name);
    if (typeof value !== "string" || !value || Buffer.byteLength(value) > 65536)
      throw new Error("Invalid automation secret value");
    this.set(key, { value });
  }
  deleteAutomationSecret(name: unknown): void {
    this.delete(automationSecretKey(name));
  }
  listAutomationSecretNames(): string[] {
    return Object.keys(this.read().entries)
      .filter((key) => AUTOMATION_KEY.test(key))
      .map((key) => key.slice("automation:secret:".length))
      .sort();
  }
  delete(key: string): void {
    const data = this.read();
    delete data.entries[validateKey(key)];
    this.write(data);
  }
}
export function createCredentialRequestHandler(vault: CredentialVault) {
  return async (method: string, params: unknown): Promise<unknown> => {
    const body = (params ?? {}) as {
      key?: string;
      value?: Record<string, unknown>;
    };
    if (typeof body.key !== "string" || !CHANNEL_KEY.test(body.key)) throw new Error("Invalid channel credential key");
    if (method === "channelSecrets.get") return vault.get(body.key);
    if (method === "channelSecrets.set") {
      if (!body.value || typeof body.value !== "object") throw new Error("Credential value is required");
      vault.set(body.key, body.value);
      return { ok: true };
    }
    if (method === "channelSecrets.delete") {
      vault.delete(body.key);
      return { ok: true };
    }
    throw new Error(`Unsupported Host request: ${method}`);
  };
}
export function createAutomationSecretRequestHandler(vault: CredentialVault) {
  return async (method: string, params: unknown): Promise<string | null> => {
    if (method !== "automationSecrets.get") throw new Error("Automation secret access is read-only");
    const name =
      params && typeof params === "object"
        ? (
            params as {
              name?: unknown;
            }
          ).name
        : undefined;
    const secret = vault.get(automationSecretKey(name));
    if (secret === null) return null;
    if (typeof secret.value !== "string") throw new Error("Invalid automation secret payload");
    return secret.value;
  };
}

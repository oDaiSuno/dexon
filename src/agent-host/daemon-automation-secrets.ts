import { randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { RpcError } from "../contract/types.ts";
import { isAutomationSecretName, isAutomationSecretValue } from "../shared/automation/secret-name.ts";
import type { SecretReader } from "./automation";

interface SecretFile {
  readonly version: 1;
  readonly secrets: Record<string, string>;
}

const unsupportedHardLinkCodes = new Set(["EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EXDEV"]);

async function removeTemporaryFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function createInitialPrivateFile(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      await link(temporaryPath, filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        if (!code || !unsupportedHardLinkCodes.has(code)) throw error;
        try {
          await writeFile(filePath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
        } catch (creationError) {
          if ((creationError as NodeJS.ErrnoException).code !== "EEXIST") throw creationError;
        }
      }
    }
    await chmod(filePath, 0o600);
  } finally {
    await removeTemporaryFile(temporaryPath);
  }
}

async function writePrivateJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } finally {
    await removeTemporaryFile(temporaryPath);
  }
}

export class DaemonAutomationSecrets implements SecretReader {
  private readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();

  private constructor(filePath: string) {
    this.filePath = filePath;
  }

  static async open(filePath: string): Promise<DaemonAutomationSecrets> {
    const store = new DaemonAutomationSecrets(filePath);
    await store.initialize();
    return store;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async checkFile(allowMissing = false): Promise<boolean> {
    try {
      if (!(await lstat(this.filePath)).isFile()) throw new Error("Invalid file");
      return true;
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    let exists: boolean;
    try {
      exists = await this.checkFile(true);
      if (!exists) await createInitialPrivateFile(this.filePath, JSON.stringify({ version: 1, secrets: {} }));
    } catch {
      throw new Error("Unable to read automation secrets");
    }
    await this.load();
    if (exists) {
      try {
        await chmod(this.filePath, 0o600);
      } catch {
        throw new Error("Unable to read automation secrets");
      }
    }
  }

  private async load(): Promise<SecretFile> {
    let contents: string;
    try {
      await this.checkFile();
      contents = await readFile(this.filePath, "utf8");
    } catch {
      throw new Error("Unable to read automation secrets");
    }
    try {
      const data: unknown = JSON.parse(contents);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid file");
      const { version, secrets } = data as Record<string, unknown>;
      if (
        version !== 1 ||
        !secrets ||
        typeof secrets !== "object" ||
        Array.isArray(secrets) ||
        Object.entries(secrets).some(
          ([name, value]) => !isAutomationSecretName(name) || !isAutomationSecretValue(value),
        )
      )
        throw new Error("Invalid file");
      return { version, secrets: secrets as Record<string, string> };
    } catch {
      throw new Error("Invalid automation secret file");
    }
  }

  private async save(data: SecretFile): Promise<void> {
    try {
      await this.checkFile();
      await writePrivateJsonFile(this.filePath, data);
    } catch {
      throw new Error("Unable to write automation secrets");
    }
  }

  async read(name: string): Promise<string | null> {
    return this.enqueue(async () => {
      const { secrets } = await this.load();
      return Object.hasOwn(secrets, name) ? secrets[name] : null;
    });
  }

  async set(name: unknown, value: unknown): Promise<void> {
    if (!isAutomationSecretName(name))
      throw new RpcError({ code: "BAD_REQUEST", message: "Invalid automation secret name" });
    if (!isAutomationSecretValue(value))
      throw new RpcError({ code: "BAD_REQUEST", message: "Invalid automation secret value" });
    await this.enqueue(async () => {
      const data = await this.load();
      Object.defineProperty(data.secrets, name, { value, enumerable: true, configurable: true, writable: true });
      await this.save(data);
    });
  }

  async delete(name: unknown): Promise<void> {
    if (!isAutomationSecretName(name))
      throw new RpcError({ code: "BAD_REQUEST", message: "Invalid automation secret name" });
    await this.enqueue(async () => {
      const data = await this.load();
      if (!Object.hasOwn(data.secrets, name)) return;
      delete data.secrets[name];
      await this.save(data);
    });
  }

  async listNames(): Promise<readonly string[]> {
    return this.enqueue(async () => Object.keys((await this.load()).secrets).sort());
  }
}

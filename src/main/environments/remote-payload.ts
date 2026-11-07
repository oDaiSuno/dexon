import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { EnvironmentConnectionError } from "./supervisor-policy.ts";
export interface RemotePayload {
  os: string;
  arch: string;
  file: string;
  sha256: string;
  bytes: number;
}
export class RemotePayloadCatalog {
  readonly version: string;
  private readonly payloads: RemotePayload[];
  readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
    const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8")) as {
      version?: unknown;
      payloads?: unknown;
    };
    if (
      typeof manifest.version !== "string" ||
      !/^[a-z0-9._-]+$/iu.test(manifest.version) ||
      !Array.isArray(manifest.payloads)
    )
      throw new Error("Invalid remote payload manifest");
    this.version = manifest.version;
    this.payloads = manifest.payloads.map((value: RemotePayload) => {
      if (
        !value ||
        typeof value.os !== "string" ||
        typeof value.arch !== "string" ||
        typeof value.file !== "string" ||
        path.basename(value.file) !== value.file ||
        !/^[a-f0-9]{64}$/u.test(value.sha256) ||
        !Number.isSafeInteger(value.bytes) ||
        value.bytes <= 0
      )
        throw new Error("Invalid remote payload asset");
      return value;
    });
  }
  forPlatform(os: string, arch: string): RemotePayload & { path: string } {
    const payload = this.payloads.find((entry) => entry.os === os && entry.arch === arch);
    if (!payload)
      throw new EnvironmentConnectionError("blocked", "unsupported", `No bundled remote runtime for ${os}-${arch}`);
    const file = path.join(this.directory, payload.file);
    if (statSync(file).size !== payload.bytes) throw new Error("Remote payload size does not match manifest");
    return { ...payload, path: file };
  }
}

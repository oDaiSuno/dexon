import { compareSemver } from "../../shared/node-version.ts";
import { createReadStream } from "node:fs";
import type { SshEnvironmentTarget } from "../../contract/environment.ts";
import type { ConnectionStage } from "../../contract/environment-status.ts";
import { RemotePayloadCatalog, type RemotePayload } from "./remote-payload.ts";
import { buildRemoteProbeScript, parseRemoteProbe, runtimeDiagnosis, type RemoteProbe } from "./remote-probe.ts";
import { runSsh } from "./ssh-command.ts";
import { remotePath, shellQuote } from "./ssh-scripts.ts";
import { EnvironmentConnectionError } from "./supervisor-policy.ts";
export type StageReporter = (stage: ConnectionStage, progress?: number | null) => void;
export interface ProvisionedRuntime {
  probe: RemoteProbe;
  nodePath: string;
  payloadVersion: string;
  daemonScriptPath: string;
  restartDaemon: boolean;
  updatePending: boolean;
}
export function planRuntimeUpgrade(
  probe: RemoteProbe,
  version: string,
): { deploy: boolean; restartDaemon: boolean; updatePending: boolean } {
  const remoteVersion = /^(\d+\.\d+\.\d+)/u.exec(probe.daemon.payloadVersion ?? "")?.[1];
  const desktopVersion = /^(\d+\.\d+\.\d+)/u.exec(version)?.[1];
  const newer = remoteVersion && desktopVersion && compareSemver(remoteVersion, desktopVersion) > 0;
  if (probe.daemon.running && newer) return { deploy: false, restartDaemon: false, updatePending: false };
  const skew = probe.daemon.running && probe.daemon.payloadVersion !== version;
  const restartDaemon = skew && probe.daemon.ownership === "managed" && probe.daemon.activeSessions === 0;
  const updatePending = skew && !restartDaemon;
  return { deploy: !probe.installed && !updatePending, restartDaemon, updatePending };
}
export function buildPayloadInstallScript(
  target: SshEnvironmentTarget,
  nodePath: string,
  version: string,
  payload: Pick<RemotePayload, "sha256">,
): string {
  if (!/^[a-z0-9._-]+$/iu.test(version) || !/^[a-f0-9]{64}$/u.test(payload.sha256) || !nodePath.startsWith("/"))
    throw new Error("Invalid payload install request");
  return `set -eu
umask 077
state=${remotePath(target.remoteStateDir, ".dexon")}
command -v tar >/dev/null 2>&1 || { printf 'unsupported: tar executable is unavailable\\n' >&2; exit 1; }
mkdir -p "$state/runtime"
incoming=$(mktemp -d "$state/runtime/.incoming.XXXXXX")
trap 'rm -rf "$incoming"' EXIT HUP INT TERM
cat > "$incoming/payload.tar.gz"
actual=$(${shellQuote(nodePath)} -e 'const fs=require("node:fs"),crypto=require("node:crypto");const hash=crypto.createHash("sha256");fs.createReadStream(process.argv[1]).on("data",chunk=>hash.update(chunk)).on("error",()=>process.exit(1)).on("end",()=>process.stdout.write(hash.digest("hex")))' "$incoming/payload.tar.gz")
[ "$actual" = ${shellQuote(payload.sha256)} ] || { printf 'Invalid remote payload checksum\\n' >&2; exit 1; }
mkdir "$incoming/content"
tar -xzf "$incoming/payload.tar.gz" -C "$incoming/content"
[ -f "$incoming/content/index.mjs" ] || { printf 'Invalid runtime payload entry\\n' >&2; exit 1; }
touch "$incoming/content/.complete"
${shellQuote(nodePath)} -e 'const fs=require("node:fs"),path=require("node:path");try{fs.renameSync(process.argv[1],process.argv[2])}catch(error){if(!["EEXIST","ENOTEMPTY"].includes(error.code)||!fs.existsSync(path.join(process.argv[2],".complete")))throw error}' "$incoming/content" "$state/runtime/${version}"`;
}
export class RemoteProvisioner {
  private readonly catalog: RemotePayloadCatalog;
  constructor(catalog: RemotePayloadCatalog) {
    this.catalog = catalog;
  }
  async probe(
    target: SshEnvironmentTarget,
    signal?: AbortSignal,
    report: StageReporter = () => {},
  ): Promise<RemoteProbe> {
    report("authenticating");
    let authenticated = false;
    const output = await runSsh(target, buildRemoteProbeScript(target, this.catalog.version), {
      signal,
      onStdout: (chunk) => {
        if (!authenticated && chunk.includes("DEXON\tHOME\t")) {
          authenticated = true;
          report("checking-runtime");
        }
      },
    });
    report("checking-runtime");
    try {
      return parseRemoteProbe(output);
    } catch (error) {
      throw new EnvironmentConnectionError(
        "blocked",
        "configuration",
        error instanceof Error ? error.message : "Invalid remote probe response",
      );
    }
  }
  async prepare(
    target: SshEnvironmentTarget,
    signal?: AbortSignal,
    report: StageReporter = () => {},
  ): Promise<ProvisionedRuntime> {
    const probe = await this.probe(target, signal, report);
    const diagnosis = runtimeDiagnosis(probe);
    if (diagnosis) throw new EnvironmentConnectionError("blocked", diagnosis.reason, diagnosis.detail, diagnosis);
    const node = probe.node!;
    const plan = planRuntimeUpgrade(probe, this.catalog.version);
    if (plan.deploy) {
      const payload = this.catalog.forPlatform(probe.os, probe.arch);
      report("deploying", 0);
      await runSsh(target, buildPayloadInstallScript(target, node.path, this.catalog.version, payload), {
        signal,
        timeoutMs: 300_000,
        stdin: createReadStream(payload.path),
        bytesTotal: payload.bytes,
        onProgress: (progress) => report("deploying", progress),
      });
    }
    return {
      probe,
      nodePath: node.path,
      payloadVersion: this.catalog.version,
      daemonScriptPath: `${probe.stateDir}/runtime/${this.catalog.version}/index.mjs`,
      ...plan,
    };
  }
}

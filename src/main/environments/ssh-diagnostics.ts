import type { SshEnvironmentTarget } from "../../contract/environment.ts";
import type { ConnectionFailure } from "../../contract/environment-status.ts";
export function diagnoseSshFailure(
  stderr: string,
  target: SshEnvironmentTarget,
  code?: string | number | null,
): ConnectionFailure {
  const detail = stderr.trim().slice(-4096) || "Remote SSH command failed";
  if (code === "ENOENT")
    return { kind: "blocked", diagnosis: { reason: "ssh-unavailable", detail: "SSH executable is unavailable" } };
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/iu.test(detail)) {
    const hostname = target.hostname ?? target.sshAlias;
    const knownHost =
      /Host key for (\S+) has changed/iu.exec(detail)?.[1] ??
      (target.port && target.port !== 22 ? `[${hostname}]:${target.port}` : hostname);
    const knownHostsFile =
      /(?:Offending .*? key in |remove with:.*?-f\s+["']?)([^\r\n"']*?known_hosts(?:[^\r\n"']*?))(?::\d+|["']|$)/imu
        .exec(detail)?.[1]
        ?.trim();
    return {
      kind: "blocked",
      diagnosis: {
        reason: "host-key-changed",
        detail,
        knownHost,
        fingerprint: /SHA256:[A-Za-z0-9+/=]+/u.exec(detail)?.[0] ?? null,
        mismatchLayer: "ssh-known-hosts",
        ...(knownHostsFile ? { knownHostsFile } : {}),
      },
    };
  }
  if (/Permission denied.*(?:publickey|password)|authentication failed|no supported authentication/iu.test(detail)) {
    const destination = target.user ? `${target.user}@${target.hostname ?? target.sshAlias}` : target.sshAlias;
    return {
      kind: "blocked",
      diagnosis: {
        reason: "authentication",
        detail,
        copyIdCommand: `ssh-copy-id${target.port ? ` -p ${target.port}` : ""} ${destination}`,
      },
    };
  }
  if (/EACCES|EROFS|read.only file system|permission denied/iu.test(detail))
    return {
      kind: "blocked",
      diagnosis: {
        reason: "permission",
        detail,
        path: target.remoteStateDir ?? "~/.dexon",
        suggestedStateDir: `/tmp/dexon-${target.user ?? "remote"}`,
      },
    };
  if (/unsupported:|(?:sh|uname).*not (?:found|recognized)/iu.test(detail))
    return { kind: "blocked", diagnosis: { reason: "unsupported", detail } };
  if (/bad configuration|bad owner or permissions|invalid|unknown option/iu.test(detail))
    return { kind: "blocked", diagnosis: { reason: "configuration", detail } };
  return {
    kind: "transient",
    failure: {
      reason: /timed out|timeout|aborted/iu.test(detail)
        ? "timeout"
        : /resolve hostname|network|unreachable|connection refused|reset by peer/iu.test(detail)
          ? "network"
          : "transport",
      detail,
    },
  };
}

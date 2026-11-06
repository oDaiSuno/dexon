import type { SshEnvironmentTarget } from "../../contract/environment.ts";
import { REMOTE_NODE_REQUIREMENT, type BlockedDiagnosis } from "../../contract/environment-status.ts";
import { compareSemver, satisfiesNodeRange } from "../../shared/node-version.ts";
import { computeSshStateKey, remotePath, shellQuote } from "./ssh-scripts.ts";
export interface RemoteProbe {
  home: string;
  user: string;
  stateDir: string;
  writable: boolean;
  os: string;
  arch: string;
  nodes: { path: string; version: string }[];
  node: { path: string; version: string } | null;
  installed: boolean;
  daemon: {
    running: boolean;
    ownership: "managed" | "external" | null;
    payloadVersion: string | null;
    since: number | null;
    activeSessions: number | null;
    protocolVersion: number | null;
  };
}
export function selectNode(
  nodes: readonly { path: string; version: string }[],
): { path: string; version: string } | null {
  return (
    nodes
      .filter((node) => node.path.startsWith("/") && satisfiesNodeRange(node.version))
      .sort((a, b) => compareSemver(b.version, a.version))[0] ?? null
  );
}
export function parseRemoteProbe(output: string): RemoteProbe {
  const fields = new Map<string, string>();
  const nodes: RemoteProbe["nodes"] = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!line.startsWith("DEXON\t")) continue;
    const [, key, ...values] = line.split("\t");
    if (key === "NODE" && values.length === 2) nodes.push({ path: values[0], version: values[1] });
    else fields.set(key, values.join("\t"));
  }
  for (const key of ["HOME", "USER", "STATE", "WRITABLE", "OS", "ARCH", "INSTALLED"])
    if (!fields.has(key)) throw new Error("Incomplete remote runtime probe");
  const daemon = fields.has("DAEMON")
    ? (JSON.parse(fields.get("DAEMON")!) as RemoteProbe["daemon"])
    : {
        running: false,
        ownership: null,
        payloadVersion: null,
        since: null,
        activeSessions: null,
        protocolVersion: null,
      };
  if (
    typeof daemon.running !== "boolean" ||
    (daemon.activeSessions !== null && (!Number.isSafeInteger(daemon.activeSessions) || daemon.activeSessions < 0))
  )
    throw new Error("Invalid remote daemon probe");
  return {
    home: fields.get("HOME")!,
    user: fields.get("USER")!,
    stateDir: fields.get("STATE")!,
    writable: fields.get("WRITABLE") === "1",
    os: fields.get("OS")!,
    arch: fields.get("ARCH")!,
    nodes,
    node: selectNode(nodes),
    installed: fields.get("INSTALLED") === "1",
    daemon,
  };
}
export function runtimeDiagnosis(probe: RemoteProbe): BlockedDiagnosis | null {
  const detail = "Remote Node.js must satisfy >=22.19.0 <23";
  const upgradeCommand = "nvm install 22 && nvm alias default 22";
  if (
    ![
      ["linux", "x64"],
      ["linux", "arm64"],
      ["darwin", "arm64"],
    ].some(([os, arch]) => probe.os === os && probe.arch === arch)
  )
    return { reason: "unsupported", detail: `Unsupported remote platform ${probe.os}-${probe.arch}` };
  if (!probe.node)
    return probe.nodes.length
      ? {
          reason: "unsupported-node-version",
          detail,
          detectedVersion: probe.nodes.map((node) => node.version).join(", "),
          required: REMOTE_NODE_REQUIREMENT,
          upgradeCommand,
        }
      : { reason: "missing-node", detail, required: REMOTE_NODE_REQUIREMENT, upgradeCommand };
  if (!probe.writable)
    return {
      reason: "permission",
      detail: `Remote state directory is not writable: ${probe.stateDir}`,
      path: probe.stateDir,
      suggestedStateDir: `/tmp/dexon-${probe.user.replace(/[^a-z0-9_-]/giu, "_") || "remote"}`,
    };
  return null;
}
export function buildRemoteProbeScript(target: SshEnvironmentTarget, payloadVersion: string): string {
  if (!/^[a-z0-9._-]+$/iu.test(payloadVersion)) throw new Error("Invalid payload version");
  const key = computeSshStateKey(target);
  return `set -eu
state=${remotePath(target.remoteStateDir, ".dexon")}
printf 'DEXON\\tHOME\\t%s\\n' "$HOME"
printf 'DEXON\\tUSER\\t%s\\n' "$(id -un)"
printf 'DEXON\\tSTATE\\t%s\\n' "$state"
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; esac
printf 'DEXON\\tOS\\t%s\\nDEXON\\tARCH\\t%s\\n' "$os" "$arch"
parent="$state"
while [ ! -e "$parent" ] && [ "$parent" != / ]; do parent=$(dirname "$parent"); done
writable=0
if [ -d "$parent" ] && [ -w "$parent" ]; then writable=1; fi
printf 'DEXON\\tWRITABLE\\t%s\\n' "$writable"
installed=0
[ ! -f "$state/runtime/${payloadVersion}/.complete" ] || installed=1
printf 'DEXON\\tINSTALLED\\t%s\\n' "$installed"
best=''
best_minor=-1
best_patch=-1
login_node=$("\${SHELL:-/bin/sh}" -lc 'command -v node' 2>/dev/null | tail -n 1 || true)
for candidate in "$(command -v node 2>/dev/null || true)" "$login_node" "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.volta/bin/node "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node "$HOME"/.local/share/fnm/aliases/*/bin/node /usr/local/bin/node /opt/homebrew/bin/node; do
  [ -x "$candidate" ] || continue
  info=$("$candidate" -p 'process.execPath + "\\t" + process.versions.node' 2>/dev/null) || continue
  printf 'DEXON\\tNODE\\t%s\\n' "$info"
  version=$(printf '%s' "$info" | cut -f2)
  valid=$("$candidate" -p 'const m=/^22\\.(\\d+)\\.(\\d+)$/.exec(process.versions.node); m && Number(m[1])>=19 ? m[1]+" "+m[2] : ""' 2>/dev/null) || continue
  [ -n "$valid" ] || continue
  minor=\${valid% *}
  patch=\${valid#* }
  if [ "$minor" -gt "$best_minor" ] || { [ "$minor" -eq "$best_minor" ] && [ "$patch" -gt "$best_patch" ]; }; then
    best=$(printf '%s' "$info" | cut -f1)
    best_minor=$minor
    best_patch=$patch
  fi
done
[ -n "$best" ] || exit 0
"$best" - "$state" ${shellQuote(key)} <<'DEXON_PROBE'
${String.raw`const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const [state, key] = process.argv.slice(2);
let ledger = path.join(state, "ssh-launch", key);
if (!fs.existsSync(path.join(ledger, "managed"))) ledger = path.join(process.env.HOME, ".dexon", "ssh-launch", key);
const read = name => { try { return fs.readFileSync(path.join(ledger, name), "utf8").trim(); } catch { return ""; } };
const absent = { running: false, ownership: null, payloadVersion: null, since: null, activeSessions: null, protocolVersion: null };
const report = value => process.stdout.write("DEXON\tDAEMON\t" + JSON.stringify(value) + "\n");
(async () => {
  const port = read("port");
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) return report(absent);
  const token = fs.readFileSync(path.join(state, "auth-token"), "utf8").trim();
  const expected = JSON.parse(fs.readFileSync(path.join(state, "environment.json"), "utf8")).environmentId;
  const nonce = crypto.randomBytes(16).toString("hex");
  const response = await fetch("http://127.0.0.1:" + port + "/.well-known/dexon/environment", { headers: { "x-dexon-nonce": nonce }, signal: AbortSignal.timeout(2000) });
  if (response.headers.get("x-dexon-proof") !== crypto.createHmac("sha256", token).update(nonce).digest("hex")) return report(absent);
  const descriptor = await response.json();
  if (descriptor.environmentId !== expected) return report(absent);
  const activeSessions = await new Promise(resolve => {
    const url = new URL("ws://127.0.0.1:" + port + "/rpc");
    url.searchParams.set("environmentId", expected);
    url.searchParams.set("protocolVersion", String(descriptor.protocolVersion));
    url.searchParams.set("token", token);
    const socket = new WebSocket(url);
    const finish = count => { clearTimeout(timer); socket.close(); resolve(count); };
    const timer = setTimeout(() => finish(null), 2000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ kind: "request", id: "probe", method: "sessions.list", params: null })));
    socket.addEventListener("error", () => finish(null), { once: true });
    socket.addEventListener("message", event => {
      try { const message = JSON.parse(event.data); if (message.id === "probe") finish(message.ok && Array.isArray(message.result.runningSessionIds) ? message.result.runningSessionIds.length : null); } catch { finish(null); }
    });
  });
  report({ running: true, ownership: read("managed") === "managed" ? "managed" : "external", payloadVersion: descriptor.runtime?.payloadVersion ?? null, since: descriptor.runtime?.startedAt ?? null, activeSessions, protocolVersion: descriptor.protocolVersion });
})().catch(() => report(absent));`}
DEXON_PROBE`;
}

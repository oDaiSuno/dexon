import fs from "node:fs";

function scenarioEntry(host) {
  const file = process.env.DEXON_FAKE_SSH_SCENARIO;
  if (!file) return {};
  try {
    const scenario = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...(scenario.default ?? {}), ...(scenario.hosts?.[host] ?? {}) };
  } catch {
    return {};
  }
}

const args = process.argv.slice(2);
let port = 22;
let host = "";
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "-p") port = Number(args[(index += 1)]);
  else if (args[index] === "-T" || args[index] === "-t") index += 1;
  else if (!args[index].startsWith("-")) host = args[index];
}
const entry = scenarioEntry(host);
if (entry.unreachable) process.exit(1);
const key = entry.hostKey ?? {
  type: "ssh-ed25519",
  blob: "AAAAC3NzaC1lZDI1NTE5AAAAILTeFB4/nzVyeC8AD1sIm+msF3j0rgd+XKKJAaq8vRox",
};
const pattern = port === 22 ? host : `[${host}]:${port}`;
process.stdout.write(`# ${host}:${port} SSH-2.0-OpenSSH_9.6\n${pattern} ${key.type} ${key.blob}\n`);

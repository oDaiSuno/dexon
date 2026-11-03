import type { ParseResult, SshTarget } from "./workspace-ref.ts";

export interface SshAddress {
  readonly target: SshTarget;
  readonly path?: string;
}

export function parseSshAuthority(raw: string): ParseResult<SshTarget> {
  const match = raw.match(/^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::([0-9]+))?$/);
  if (!match) return { ok: false, error: "Invalid server address" };
  const [, user, hostPart, portPart] = match;
  const host = hostPart.startsWith("[") ? hostPart.slice(1, -1) : hostPart;
  const port = portPart === undefined ? undefined : Number(portPart);
  if (user !== undefined && !/^[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(user))
    return { ok: false, error: "Invalid server user" };
  if (hostPart.startsWith("[") || !/^[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(host)) {
    try {
      if (!hostPart.startsWith("[") || !host.includes(":")) throw new Error("Invalid host");
      new URL(`http://${hostPart}`);
    } catch {
      return { ok: false, error: "Invalid server host" };
    }
  }
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    return { ok: false, error: "Server port must be between 1 and 65535" };
  return { ok: true, value: { ...(user ? { user } : {}), host, ...(port !== undefined ? { port } : {}) } };
}

export function parseSshAddress(raw: string): ParseResult<SshAddress> {
  if (/^[A-Za-z]:[/\\]/.test(raw)) return { ok: false, error: "A server address cannot be a local drive path" };
  let authority = raw;
  let remotePath: string | undefined;
  if (/^ssh:\/\//i.test(raw)) {
    const match = raw.match(/^ssh:\/\/([^/?#]+)(\/[^?#]*)?$/i);
    if (!match) return { ok: false, error: "Invalid server URL" };
    authority = match[1];
    if (match[2] !== undefined) {
      try {
        remotePath = decodeURIComponent(match[2]);
      } catch {
        return { ok: false, error: "Invalid encoded server path" };
      }
    }
  } else {
    const scp = raw.match(/^((?:[^@/]+@)?(?:\[[^\]]+\]|[A-Za-z0-9._-]+)):(.*)$/);
    if (scp && !/^[0-9]+$/.test(scp[2]) && !scp[2].startsWith("//")) {
      authority = scp[1];
      remotePath = scp[2];
    }
  }
  const target = parseSshAuthority(authority);
  if (!target.ok) return target;
  return { ok: true, value: { target: target.value, ...(remotePath !== undefined ? { path: remotePath } : {}) } };
}

function commandWords(raw: string): ParseResult<string[]> {
  const words: string[] = [];
  let word = "";
  let quote = "";
  let escaped = false;
  let started = false;
  for (const character of raw) {
    if (escaped) {
      word += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else word += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += character;
      started = true;
    }
  }
  if (quote || escaped) return { ok: false, error: "Unfinished quoted server command" };
  if (started) words.push(word);
  return { ok: true, value: words };
}

export function parseSshCommand(raw: string): ParseResult<SshAddress> {
  const words = commandWords(raw);
  if (!words.ok) return words;
  const options = new Map<string, string>();
  let destination: string | undefined;
  let endOptions = false;
  for (let index = 1; index < words.value.length; index += 1) {
    const word = words.value[index];
    if (!endOptions && word === "--") {
      endOptions = true;
      continue;
    }
    if (!endOptions && word.startsWith("-")) {
      const option = word.slice(0, 2);
      if (!["-p", "-l", "-i", "-J"].includes(option) || options.has(option))
        return { ok: false, error: "Unsupported or repeated server option" };
      const value = word.slice(2) || words.value[++index];
      if (!value || value.startsWith("-")) return { ok: false, error: "A server option value is required" };
      options.set(option, value);
    } else {
      if (destination) return { ok: false, error: "Only one server address is allowed" };
      destination = word;
    }
  }
  if (!destination) return { ok: false, error: "A server address is required" };
  const address = parseSshAddress(destination);
  if (!address.ok) return address;
  const portInput = options.get("-p");
  const user = options.get("-l") ?? address.value.target.user;
  const port = portInput === undefined ? address.value.target.port : Number(portInput);
  if (
    (address.value.target.user && user !== address.value.target.user) ||
    (address.value.target.port !== undefined && port !== address.value.target.port)
  )
    return { ok: false, error: "Conflicting server user or port" };
  if (portInput !== undefined && !/^[0-9]+$/.test(portInput)) return { ok: false, error: "Invalid server port" };
  const host = address.value.target.host.includes(":") ? `[${address.value.target.host}]` : address.value.target.host;
  const target = parseSshAuthority(`${user ? `${user}@` : ""}${host}${port !== undefined ? `:${port}` : ""}`);
  if (!target.ok) return target;
  return { ok: true, value: { ...address.value, target: target.value } };
}

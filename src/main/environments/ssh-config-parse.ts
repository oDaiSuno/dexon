export interface SshConfigDirectives {
  hosts: string[];
  includes: string[];
}
export function parseSshConfig(text: string): SshConfigDirectives {
  const hosts: string[] = [],
    includes: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const tokens: string[] = [];
    let value = "",
      quote = "",
      escaped = false;
    for (const char of line.trim()) {
      if (escaped) {
        value += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = "";
        else value += char;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === "#") break;
      if (/\s/u.test(char) || (char === "=" && tokens.length === 0)) {
        if (value) {
          tokens.push(value);
          value = "";
        }
      } else value += char;
    }
    if (value) tokens.push(value);
    const directive = tokens.shift()?.toLowerCase();
    if (directive === "host") hosts.push(...tokens.filter((alias) => /^[a-z0-9][a-z0-9._-]{0,252}$/iu.test(alias)));
    if (directive === "include") includes.push(...tokens);
  }
  return { hosts: [...new Set(hosts)], includes: [...new Set(includes)] };
}
export function parseSshConfigHosts(text: string): string[] {
  return parseSshConfig(text).hosts;
}
export function parseSshG(text: string): {
  hostname: string;
  user: string | null;
  port: number;
  proxyJump: string | null;
  identityFile: string | null;
} {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^(\S+)\s+(.+)$/u.exec(line.trim());
    if (match && !values.has(match[1])) values.set(match[1].toLowerCase(), match[2]);
  }
  const port = Number(values.get("port") ?? 22);
  if (!values.get("hostname") || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid resolved SSH host");
  const optional = (key: string) => (values.get(key) && values.get(key) !== "none" ? values.get(key)! : null);
  return {
    hostname: values.get("hostname")!,
    user: optional("user"),
    port,
    proxyJump: optional("proxyjump"),
    identityFile: optional("identityfile"),
  };
}

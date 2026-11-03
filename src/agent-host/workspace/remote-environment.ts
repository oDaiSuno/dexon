const FORWARDED_PI_VARIABLES = new Set(["PI_SESSION_ID", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"]);
const FORWARDED_LOCALE_VARIABLES = new Set(["LANG", "LC_ALL", "LC_CTYPE", "TERM"]);

export function remoteCommandEnvironment(local: NodeJS.ProcessEnv | undefined): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(local ?? {})) {
    if (typeof value !== "string") continue;
    if (FORWARDED_PI_VARIABLES.has(name) || FORWARDED_LOCALE_VARIABLES.has(name)) forwarded[name] = value;
  }
  return forwarded;
}

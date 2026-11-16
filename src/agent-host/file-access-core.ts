import { promises as fs } from "fs";
import path from "path";

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;
const SLOW_LOOKUP_SLOTS = 4;
const CHECK_TIMEOUT_MS = 2_000;
const MISSING_PREFIX_TTL_MS = 10_000;
const MISSING_PREFIX_LIMIT = 256;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

interface PathRules {
  readonly resolver: path.PlatformPath;
  readonly separator: string;
  readonly fold: (value: string) => string;
}

const WINDOWS_RULES: PathRules = { resolver: path.win32, separator: "\\", fold: (value) => value.toLowerCase() };
const NATIVE_RULES: PathRules = { resolver: path, separator: path.sep, fold: (value) => value };
const foldOnDisk = process.platform === "win32" ? WINDOWS_RULES.fold : NATIVE_RULES.fold;

interface Resolution {
  readonly canonical: string;
  readonly missingPrefix?: { readonly lexical: string; readonly canonical: string };
}

async function resolveOnDisk(target: string): Promise<Resolution> {
  let current = path.resolve(target);
  const missing: string[] = [];
  let missingCode: unknown;
  while (true) {
    try {
      const existing = path.normalize(await fs.realpath(current));
      const canonical = path.normalize(path.join(existing, ...missing));
      if (missing.length === 0 || (missingCode !== "ENOENT" && missingCode !== "ENOTDIR")) return { canonical };
      return {
        canonical,
        missingPrefix: { lexical: path.join(current, missing[0]), canonical: path.join(existing, missing[0]) },
      };
    } catch (error) {
      const parent = path.dirname(current);
      if (parent === current) return { canonical: path.normalize(path.join(current, ...missing)) };
      missing.unshift(path.basename(current));
      missingCode = (error as NodeJS.ErrnoException).code;
      current = parent;
    }
  }
}

export async function canonicalPath(filePath: string, useWindowsRules: boolean): Promise<string> {
  const resolver = useWindowsRules ? path.win32 : path;
  if (resolver !== path) return resolver.normalize(resolver.resolve(filePath));
  return (await resolveOnDisk(filePath)).canonical;
}

function contains(root: string, candidate: string, separator: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(separator) ? root : root + separator);
}

function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  const controller = new AbortController();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      controller.abort();
      resolve(undefined);
    }, CHECK_TIMEOUT_MS);
    (async () => work(controller.signal))().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

function createSlots(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async <T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> => {
    signal.throwIfAborted();
    if (active < limit) active += 1;
    else
      await new Promise<void>((resolve, reject) => {
        const grant = (): void => {
          signal.removeEventListener("abort", cancel);
          resolve();
        };
        const cancel = (): void => {
          const index = waiting.indexOf(grant);
          if (index >= 0) waiting.splice(index, 1);
          reject(signal.reason);
        };
        waiting.push(grant);
        signal.addEventListener("abort", cancel, { once: true });
      });
    try {
      return await task();
    } finally {
      release();
    }
  };
}

interface RootForms {
  readonly canonical: readonly string[];
  readonly lexical: readonly string[];
}

interface Comparison {
  readonly rules: PathRules;
  readonly roots: RootForms;
}

export interface AllowedRoots {
  allows(target: string): Promise<boolean>;
}

export interface PathAccess {
  prepare(roots: Iterable<string>): Promise<AllowedRoots>;
}

export function createPathAccess(): PathAccess {
  const inSlowSlot = createSlots(SLOW_LOOKUP_SLOTS);
  const lookups = new Map<string, Promise<Resolution>>();
  const missingPrefixes = new Map<string, { readonly canonical: string; readonly expiresAt: number }>();

  const lookup = (target: string): Promise<Resolution> => {
    const key = path.resolve(target);
    let pending = lookups.get(key);
    if (!pending) {
      pending = resolveOnDisk(key).finally(() => lookups.delete(key));
      lookups.set(key, pending);
    }
    return pending;
  };

  const limitedLookup = (target: string, signal: AbortSignal): Promise<Resolution> =>
    lookups.get(path.resolve(target)) ?? inSlowSlot(() => lookup(target), signal);

  const isOutside = (prefix: string, rootPaths: readonly string[]): boolean => {
    const candidate = foldOnDisk(prefix);
    return rootPaths.every((root) => !contains(root, candidate, path.sep) && !contains(candidate, root, path.sep));
  };

  const remembersMissing = (lexical: string, rootPaths: readonly string[]): boolean => {
    const now = Date.now();
    for (let current = lexical; ; current = path.dirname(current)) {
      const key = foldOnDisk(current);
      const entry = missingPrefixes.get(key);
      if (entry && entry.expiresAt <= now) missingPrefixes.delete(key);
      else if (entry && isOutside(entry.canonical, rootPaths)) return true;
      if (path.dirname(current) === current) return false;
    }
  };

  const rememberMissing = (resolution: Resolution, rootPaths: readonly string[]): void => {
    const prefix = resolution.missingPrefix;
    if (!prefix || !isOutside(prefix.canonical, rootPaths)) return;
    const key = foldOnDisk(prefix.lexical);
    missingPrefixes.delete(key);
    missingPrefixes.set(key, { canonical: prefix.canonical, expiresAt: Date.now() + MISSING_PREFIX_TTL_MS });
    if (missingPrefixes.size > MISSING_PREFIX_LIMIT) missingPrefixes.delete(missingPrefixes.keys().next().value!);
  };

  const formsOf = async (rootPaths: readonly string[], rules: PathRules): Promise<RootForms> => {
    const forms = await Promise.all(
      rootPaths.map(async (root) => {
        const lexical = rules.resolver.normalize(rules.resolver.resolve(root));
        const canonical =
          rules.resolver === path ? ((await withDeadline(() => lookup(root)))?.canonical ?? lexical) : lexical;
        return { canonical: rules.fold(canonical), lexical: rules.fold(lexical) };
      }),
    );
    return { canonical: forms.map((form) => form.canonical), lexical: forms.map((form) => form.lexical) };
  };

  const allows = async (target: string, comparisons: readonly Comparison[], rootPaths: readonly string[]) => {
    const active = comparisons.filter((comparison) => comparison.roots.canonical.length > 0);
    for (const { rules, roots } of active) {
      if (rules.resolver === path) continue;
      const candidate = rules.fold(rules.resolver.normalize(rules.resolver.resolve(target)));
      if (roots.canonical.some((root) => contains(root, candidate, rules.separator))) return true;
    }
    const onDisk = active.filter((comparison) => comparison.rules.resolver === path);
    if (onDisk.length === 0) return false;
    const lexical = path.normalize(path.resolve(target));
    const inside = onDisk.some(({ rules, roots }) =>
      [...roots.lexical, ...roots.canonical].some((root) => contains(root, rules.fold(lexical), rules.separator)),
    );
    if (!inside && remembersMissing(lexical, rootPaths)) return false;
    const resolution = inside
      ? await lookup(target)
      : await withDeadline(async (signal) => {
          const outside = await limitedLookup(target, signal);
          rememberMissing(outside, rootPaths);
          return outside;
        });
    if (!resolution) return false;
    return onDisk.some(({ rules, roots }) =>
      roots.canonical.some((root) => contains(root, rules.fold(resolution.canonical), rules.separator)),
    );
  };

  return {
    async prepare(rootPaths) {
      const roots = [...rootPaths];
      const windowsStyleRoots = roots.filter(isWindowsAbsolutePath);
      const nativeStyleRoots = roots.filter((root) => !isWindowsAbsolutePath(root));
      const [windowsStyle, nativeStyleAsWindows, nativeStyle] = await Promise.all([
        formsOf(windowsStyleRoots, WINDOWS_RULES),
        formsOf(nativeStyleRoots, WINDOWS_RULES),
        formsOf(nativeStyleRoots, NATIVE_RULES),
      ]);
      const everyWindowsStyle: RootForms = {
        canonical: [...windowsStyle.canonical, ...nativeStyleAsWindows.canonical],
        lexical: [...windowsStyle.lexical, ...nativeStyleAsWindows.lexical],
      };
      const canonicalOnDisk = [...everyWindowsStyle.canonical, ...nativeStyle.canonical].map(foldOnDisk);
      return {
        allows: (target) =>
          allows(
            target,
            isWindowsAbsolutePath(target)
              ? [{ rules: WINDOWS_RULES, roots: everyWindowsStyle }]
              : [
                  { rules: WINDOWS_RULES, roots: windowsStyle },
                  { rules: NATIVE_RULES, roots: nativeStyle },
                ],
            canonicalOnDisk,
          ),
      };
    },
  };
}

export const pathAccess = createPathAccess();

export type DirectoryValidation =
  | { ok: true; path: string; canonicalPath: string }
  | { ok: false; error: string; reason: "missing" | "not-directory" | "denied" | "io-error" };

const MISSING_DIRECTORY: DirectoryValidation = { ok: false, reason: "missing", error: "Directory does not exist" };
const NOT_A_DIRECTORY: DirectoryValidation = { ok: false, reason: "not-directory", error: "Not a directory" };

async function hasNonDirectoryAncestor(candidate: string): Promise<boolean> {
  for (let current = path.dirname(path.resolve(candidate)); ; current = path.dirname(current)) {
    try {
      return !(await fs.stat(current)).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || path.dirname(current) === current) return false;
    }
  }
}

export async function validateExistingDirectory(candidate: unknown): Promise<DirectoryValidation> {
  if (typeof candidate !== "string" || !candidate) return MISSING_DIRECTORY;
  try {
    const canonicalPath = await fs.realpath(candidate);
    if (!(await fs.stat(canonicalPath)).isDirectory()) return NOT_A_DIRECTORY;
    return { ok: true, path: candidate, canonicalPath };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return (await hasNonDirectoryAncestor(candidate)) ? NOT_A_DIRECTORY : MISSING_DIRECTORY;
    if (code === "ENOTDIR") return NOT_A_DIRECTORY;
    if (code === "EACCES" || code === "EPERM") return { ok: false, reason: "denied", error: "Directory access denied" };
    return { ok: false, reason: "io-error", error: "Unable to access directory" };
  }
}

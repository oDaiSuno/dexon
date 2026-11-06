import fs from "node:fs";
import path from "node:path";
import { createRequire, isBuiltin } from "node:module";
export function packageNameOf(specifier) {
  if (specifier.startsWith(".") || path.isAbsolute(specifier) || isBuiltin(specifier)) return null;
  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
}
export function productionPackageClosure(root, specifiers) {
  const packages = new Map();
  const visit = (name, from, optional = false) => {
    const search = createRequire(path.join(from, "package.json")).resolve.paths(name) ?? [];
    const directory = search
      .map((entry) => path.join(entry, name))
      .find((entry) => fs.existsSync(path.join(entry, "package.json")));
    if (!directory) {
      if (optional) return;
      throw new Error(`Missing remote runtime dependency ${name}`);
    }
    const relative = path.relative(root, directory);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(`Remote package is outside project: ${directory}`);
    if (packages.has(directory)) return;
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    packages.set(directory, { directory, relative, manifest });
    for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dependency, directory);
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) visit(dependency, directory, true);
  };
  for (const name of new Set(specifiers.map(packageNameOf).filter(Boolean))) visit(name, root);
  return [...packages.values()];
}
function supportsPlatform(constraint, target) {
  if (!Array.isArray(constraint)) return true;
  return (
    !constraint.includes(`!${target}`) &&
    (!constraint.some((entry) => !entry.startsWith("!")) || constraint.includes(target))
  );
}
export function copyProductionPackages(packages, destination, target) {
  for (const entry of packages) {
    if (!supportsPlatform(entry.manifest.os, target.os) || !supportsPlatform(entry.manifest.cpu, target.arch)) continue;
    const root = entry.directory;
    fs.cpSync(root, path.join(destination, entry.relative), {
      recursive: true,
      dereference: true,
      filter: (source) => {
        const relative = path.relative(root, source).replaceAll("\\", "/");
        if (!relative) return true;
        if (
          relative
            .split("/")
            .some((part) => ["node_modules", ".git", ".github", "test", "tests", "coverage"].includes(part))
        )
          return false;
        if (/\.map$/u.test(relative) || (/\.(?:ts|tsx)$/u.test(relative) && !/\.d\.[cm]?ts$/u.test(relative)))
          return false;
        const platform = /(?:^|\/)(?:prebuilds|vendor)\/((?:linux|darwin|win32)-(?:x64|arm64))/u.exec(relative)?.[1];
        return !platform || platform === `${target.os}-${target.arch}`;
      },
    });
  }
}

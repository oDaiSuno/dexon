export interface FolderBreadcrumb {
  label: string;
  path: string;
  title: string;
}

export function folderBreadcrumbs(path: string, home = ""): FolderBreadcrumb[] {
  const windows = /^[a-z]:[\\/]|^\\\\|^\/\/[^/]/i.test(path);
  const normalize = (value: string) => (windows ? value.replace(/\\/g, "/") : value);
  const normalized = normalize(path);
  const base = normalize(home).replace(/\/+$/, "");
  const compared = windows ? normalized.toLowerCase() : normalized;
  const comparedHome = windows ? base.toLowerCase() : base;
  const withinHome = base && (compared === comparedHome || compared.startsWith(`${comparedHome}/`));
  const display = withinHome ? `~${normalized.slice(base.length)}` : normalized;
  const isHome = display === "~" || display.startsWith("~/");
  const drive = !isHome && windows ? /^[a-z]:\//i.exec(display)?.[0] : null;
  const share = !isHome && windows ? /^\/\/[^/]+\/[^/]+(?:\/|$)/.exec(display)?.[0] : null;
  const root = isHome ? "~" : drive || share || (display.startsWith("/") ? "/" : null);
  if (!root) return [];
  const separator = windows && !isHome ? "\\" : "/";
  const rootPath = isHome ? "~" : root.replace(/\/+$/, "") + "/";
  let current = rootPath.replace(/\//g, separator);
  const result = [
    {
      label: share ? current.replace(/\\$/, "") : current,
      path: current,
      title: isHome ? home || "~" : current,
    },
  ];
  for (const label of display.slice(root.length).split("/").filter(Boolean)) {
    current = `${current.endsWith(separator) ? current : current + separator}${label}`;
    result.push({ label, path: current, title: current });
  }
  return result;
}

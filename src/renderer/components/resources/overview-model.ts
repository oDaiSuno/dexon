import type { PluginPackageInfo, PluginResourceKind } from "@/lib/api-types";
import { packageKey } from "../plugins/plugin-shared";
import { sourceLabel, type Skill, type Translate } from "../skills/skill-shared";

export interface PackageResource {
  key: string;
  name: string;
  origin: string;
  pkg: PluginPackageInfo;
}

export interface CapabilitySummary {
  ready: number;
  readySkills: number;
  extensions: number;
  prompts: number;
  hidden: number;
  unavailable: number;
}

export function packageDisplayName(pkg: PluginPackageInfo): string {
  return pkg.packageName ?? pkg.source.replace(/^npm:/, "");
}

export function packageResources(packages: PluginPackageInfo[], kind: PluginResourceKind): PackageResource[] {
  return packages.flatMap((pkg) =>
    pkg.resources
      .filter((resource) => resource.kind === kind)
      .map((resource) => ({
        key: `${packageKey(pkg)}\0${resource.path}`,
        name: resource.name,
        origin: packageDisplayName(pkg),
        pkg,
      })),
  );
}

export function missingPackages(packages: PluginPackageInfo[]): PluginPackageInfo[] {
  return packages.filter((pkg) => pkg.status === "missing");
}

export function capabilitySummary(
  skills: Skill[],
  packages: PluginPackageInfo[],
  extensions: number,
  prompts: number,
): CapabilitySummary {
  const hidden = skills.filter((skill) => skill.disableModelInvocation).length;
  const readySkills = skills.length - hidden;
  const unavailable = missingPackages(packages).reduce(
    (total, pkg) => total + pkg.counts.skills + pkg.counts.extensions + pkg.counts.prompts,
    0,
  );
  return { ready: readySkills + extensions + prompts, readySkills, extensions, prompts, hidden, unavailable };
}

export function skillOriginText(skill: Skill, packages: PluginPackageInfo[], t: Translate): string {
  const pkg = packages.find((candidate) => candidate.source === skill.sourceInfo?.source);
  const origin = pkg
    ? t("resourcesFromPackage", "From {name}").replace("{name}", packageDisplayName(pkg))
    : scopeText(sourceLabel(skill), t);
  if (!skill.disableModelInvocation) return origin;
  return `${origin} · ${t("resourcesHiddenFromModel", "Hidden from the model")}`;
}

export function scopeText(label: string, t: Translate): string {
  if (label === "project") return t("resourcesSkillProject", "This project");
  if (label === "global") return t("resourcesSkillGlobal", "Global");
  return t("resourcesSkillPath", "Path");
}

export function matchesSkillQuery(skill: Skill, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle);
}

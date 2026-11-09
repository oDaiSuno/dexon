import type { ApiResult } from "@contract/api";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentView } from "@contract/environment";
import { projectKeyOf, type ProjectKey, type ProjectSpaceRef } from "@shared/project-space-state";

export type PresenceProbe = { key: ProjectKey; answer: "present" | "missing" | "unknown" };

export async function probePresence(
  ref: ProjectSpaceRef,
  view: EnvironmentView | undefined,
  validate: (path: string) => Promise<ApiResult<"system.validateCwd">>,
): Promise<PresenceProbe> {
  const key = projectKeyOf(ref);
  const phase = view?.status.phase;
  const canValidate = phase === "connected" || (ref.environmentId === PRIMARY_ENVIRONMENT_ID && phase === "available");
  if (!canValidate) return { key, answer: "unknown" };
  try {
    const result = await validate(ref.path);
    if (result.ok) return { key, answer: "present" };
    return { key, answer: result.reason === "denied" || result.reason === "io-error" ? "unknown" : "missing" };
  } catch {
    return { key, answer: "unknown" };
  }
}

export function mergeMissing(
  previous: ReadonlySet<ProjectKey>,
  probes: readonly PresenceProbe[],
): ReadonlySet<ProjectKey> {
  const next = new Set<ProjectKey>();
  for (const probe of probes)
    if (probe.answer === "missing" || (probe.answer === "unknown" && previous.has(probe.key))) next.add(probe.key);
  return next.size === previous.size && [...next].every((key) => previous.has(key)) ? previous : next;
}

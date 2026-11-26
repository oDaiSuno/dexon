import type { TaskSpec } from "../../../shared/automation/spec";
import { deriveRequiredGrant, hashScriptManifest } from "./grant";
import { normalizeTaskSpec, type NormalizeOptions } from "./normalize";
import { assertTaskSpec } from "./validate";

export function compileTaskSpec(rawSpec: unknown, opts: NormalizeOptions = {}) {
  assertTaskSpec(rawSpec);
  const spec: TaskSpec = structuredClone(rawSpec);
  normalizeTaskSpec(spec, opts);
  const hashes = opts.scriptHashes ?? hashScriptManifest(spec);
  const plan = normalizeTaskSpec(spec, { scriptHashes: hashes });
  const requiredGrant = deriveRequiredGrant(plan, spec, { scriptHashes: hashes });
  return { spec, plan, requiredGrant };
}

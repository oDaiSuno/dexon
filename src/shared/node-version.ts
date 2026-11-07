import { REMOTE_NODE_REQUIREMENT } from "../contract/environment-status.ts";
export const REQUIRED_NODE_RANGE = REMOTE_NODE_REQUIREMENT.range;
function parts(value: string): number[] | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\w.-]+)?$/u.exec(value);
  return match ? match.slice(1, 4).map(Number) : null;
}
export function compareSemver(left: string, right: string): number {
  const a = parts(left),
    b = parts(right);
  if (!a || !b) throw new Error("Invalid semantic version");
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
export function satisfiesNodeRange(value: string): boolean {
  const version = parts(value);
  return version !== null && version[0] === 22 && compareSemver(value, REMOTE_NODE_REQUIREMENT.minimum) >= 0;
}

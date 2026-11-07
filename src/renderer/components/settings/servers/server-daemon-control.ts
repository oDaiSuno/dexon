import type { EnvironmentView } from "@contract/environment";

export type ServerDaemonControl = "managed" | "external" | "unavailable" | "unknown";

export function serverDaemonControl(view: EnvironmentView): ServerDaemonControl {
  if (view.target.kind !== "ssh" || view.runtime?.ownership === "external") return "external";
  if (
    view.status.phase === "blocked" &&
    (view.status.diagnosis.reason === "unsupported" || view.status.diagnosis.reason === "ssh-unavailable")
  )
    return "unavailable";
  return view.runtime?.ownership === "managed" ? "managed" : "unknown";
}

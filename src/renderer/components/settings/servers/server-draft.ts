import type { EnvironmentDraft } from "@contract/environment-commands";
import type { EnvironmentView } from "@contract/environment";

export type ServerDraft = {
  label: string;
} & (
  | {
      kind: "ssh";
      sshAlias: string;
      hostname: string;
      user: string;
      port: string;
      identityFile: string;
      proxyJump: string;
      remotePort: string;
      remoteStateDir: string;
    }
  | { kind: "websocket"; url: string; authToken: string }
);

export function createServerDraft(view?: EnvironmentView): ServerDraft {
  if (view?.target.kind === "websocket") {
    return { kind: "websocket", label: view.label, url: view.target.url, authToken: "" };
  }
  const target = view?.target.kind === "ssh" ? view.target : undefined;
  return {
    kind: "ssh",
    label: view?.label ?? "",
    sshAlias: target?.sshAlias ?? "",
    hostname: target?.hostname ?? "",
    user: target?.user ?? "",
    port: target?.port?.toString() ?? "",
    identityFile: target?.identityFile ?? "",
    proxyJump: target?.proxyJump ?? "",
    remotePort: target?.remotePort?.toString() ?? "",
    remoteStateDir: target?.remoteStateDir ?? "",
  };
}

export function toEnvironmentDraft(draft: ServerDraft): EnvironmentDraft {
  if (draft.kind === "websocket") {
    return {
      label: draft.label.trim(),
      target: { kind: "websocket", url: draft.url.trim() },
      ...(draft.authToken ? { authToken: draft.authToken } : {}),
    };
  }
  return {
    label: draft.label.trim(),
    target: {
      kind: "ssh",
      sshAlias: draft.sshAlias.trim(),
      ...(draft.hostname.trim() ? { hostname: draft.hostname.trim() } : {}),
      ...(draft.user.trim() ? { user: draft.user.trim() } : {}),
      ...(draft.port ? { port: Number(draft.port) } : {}),
      ...(draft.identityFile.trim() ? { identityFile: draft.identityFile.trim() } : {}),
      ...(draft.proxyJump.trim() ? { proxyJump: draft.proxyJump.trim() } : {}),
      ...(draft.remotePort ? { remotePort: Number(draft.remotePort) } : {}),
      ...(draft.remoteStateDir.trim() ? { remoteStateDir: draft.remoteStateDir.trim() } : {}),
    },
  };
}

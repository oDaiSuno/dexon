import type { RemoteBrowseResult, RemoteHostCandidate } from "@contract/workspace";
import type { SshTarget } from "@shared/workspace-ref";

export interface SshConnectServices {
  listHosts: () => Promise<{ hosts: RemoteHostCandidate[] }>;
  browseRemote: (target: SshTarget, path?: string) => Promise<RemoteBrowseResult>;
  acceptHostKey: (target: SshTarget, fingerprint: string) => Promise<{ ok: true }>;
  installPython: (target: SshTarget) => Promise<{ ok: true }>;
}

export type SshHostsState =
  { status: "loading" } | { status: "ready"; hosts: RemoteHostCandidate[] } | { status: "error"; message: string };

export type SshBrowseRequest = {
  target: SshTarget;
  path?: string;
  operation: { kind: "browse" } | { kind: "accept"; fingerprint: string } | { kind: "install" };
};

export type SshConnectState =
  | { step: "list" }
  | { step: "servers"; query: string; hosts: SshHostsState }
  | {
      step: "browse";
      request: SshBrowseRequest;
      content: RemoteBrowseResult | { status: "loading" };
      filter: string;
      selectedPath: string;
    };

export type SshConnectEvent =
  | { type: "list" }
  | { type: "servers" }
  | { type: "query"; query: string }
  | { type: "hosts"; hosts: SshHostsState }
  | { type: "connect"; target: SshTarget; path?: string }
  | { type: "browsed"; request: SshBrowseRequest; result: RemoteBrowseResult }
  | { type: "browse"; path: string }
  | { type: "accept-host-key" }
  | { type: "install-python" }
  | { type: "retry" }
  | { type: "filter"; filter: string }
  | { type: "select"; path: string };

export function sshConnectReducer(state: SshConnectState, event: SshConnectEvent): SshConnectState {
  switch (event.type) {
    case "list":
      return { step: "list" };
    case "servers":
      return { step: "servers", query: "", hosts: { status: "loading" } };
    case "query":
      return state.step === "servers" ? { ...state, query: event.query } : state;
    case "connect":
      return {
        step: "browse",
        request: { target: event.target, path: event.path, operation: { kind: "browse" } },
        content: { status: "loading" },
        filter: "",
        selectedPath: event.path ?? "/",
      };
    case "browsed":
      return state.step === "browse" && state.request === event.request
        ? {
            ...state,
            content: event.result,
            selectedPath: event.result.status === "ready" ? event.result.currentPath : state.selectedPath,
          }
        : state;
    case "browse":
      return state.step === "browse"
        ? {
            ...state,
            request: { target: state.request.target, path: event.path, operation: { kind: "browse" } },
            content: { status: "loading" },
            filter: "",
            selectedPath: event.path,
          }
        : state;
    case "accept-host-key":
      return state.step === "browse" && state.content.status === "host-key-unverified"
        ? {
            ...state,
            request: { ...state.request, operation: { kind: "accept", fingerprint: state.content.fingerprint } },
            content: { status: "loading" },
          }
        : state;
    case "install-python":
      return state.step === "browse" && state.content.status === "python-missing" && state.content.canAutoInstall
        ? { ...state, request: { ...state.request, operation: { kind: "install" } }, content: { status: "loading" } }
        : state;
    case "retry":
      return state.step === "browse" && state.content.status !== "loading"
        ? { ...state, request: { ...state.request, operation: { kind: "browse" } }, content: { status: "loading" } }
        : state;
    case "filter":
      return state.step === "browse" ? { ...state, filter: event.filter } : state;
    case "select":
      return state.step === "browse" ? { ...state, selectedPath: event.path } : state;
    case "hosts":
      return state.step === "servers" ? { ...state, hosts: event.hosts } : state;
  }
}

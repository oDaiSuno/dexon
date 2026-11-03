import type { SshTarget } from "../../../shared/workspace-ref.ts";

export type RemoteConnectFailure =
  | {
      readonly code: "host-key-unverified";
      readonly target: SshTarget;
      readonly host: string;
      readonly remoteIp?: string;
      readonly keyType: string;
      readonly fingerprint: string;
      readonly rawHostKeyLine?: string;
    }
  | { readonly code: "host-key-changed"; readonly target: SshTarget; readonly detail: string }
  | {
      readonly code: "auth-required";
      readonly target: SshTarget;
      readonly copyIdCommand: string;
      readonly detail?: string;
    }
  | {
      readonly code: "python-missing";
      readonly target: SshTarget;
      readonly installCommand: string;
      readonly canAutoInstall: boolean;
      readonly detail?: string;
    }
  | { readonly code: "python-too-old"; readonly target: SshTarget; readonly version: string }
  | { readonly code: "unreachable"; readonly target: SshTarget; readonly message: string }
  | { readonly code: "protocol-error"; readonly target: SshTarget; readonly message: string };

export class RemoteConnectError extends Error {
  readonly failure: RemoteConnectFailure;

  constructor(failure: RemoteConnectFailure, message: string = failure.code) {
    super(message);
    this.name = "RemoteConnectError";
    this.failure = failure;
  }
}

export type RemoteOperationErrorCode =
  | "ENOENT"
  | "EACCES"
  | "EEXIST"
  | "ENOTDIR"
  | "EISDIR"
  | "OUTSIDE_ROOT"
  | "TOO_LARGE"
  | "SEARCH_UNAVAILABLE"
  | "TIMEOUT"
  | "CANCELLED"
  | "BAD_REQUEST"
  | "INTERNAL";

export class RemoteOperationError extends Error {
  readonly code: RemoteOperationErrorCode;

  constructor(code: RemoteOperationErrorCode, message: string) {
    super(message);
    this.name = "RemoteOperationError";
    this.code = code;
  }
}

export class RemoteTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteTransportError";
  }
}

import type { EnvironmentView } from "@contract/environment";
import type { BlockedDiagnosis } from "@contract/environment-status";

export interface BlockedDiagnosisField {
  kind:
    | "detected-version"
    | "required-version"
    | "known-host"
    | "fingerprint"
    | "known-hosts-file"
    | "expected-id"
    | "actual-id"
    | "path"
    | "protocol";
  value: string;
}

export type BlockedDiagnosisAction =
  | { kind: "copy"; text: string; purpose: "authentication" | "node-upgrade" }
  | { kind: "trust"; trust: "host-key" | "environment-identity"; fingerprint: string | null }
  | { kind: "edit-field"; field: "remoteStateDir"; suggestedValue: string }
  | null;

export interface BlockedDiagnosisView {
  reason: BlockedDiagnosis["reason"];
  title: string;
  detail: string;
  targetLabel: string;
  fields: BlockedDiagnosisField[];
  action: BlockedDiagnosisAction;
}

const diagnosisTitles = {
  authentication: "Passwordless login required",
  "missing-node": "Node.js is not installed",
  "unsupported-node-version": "Node.js version is not supported",
  "host-key-changed": "SSH host key changed",
  "identity-mismatch": "Server identity changed",
  permission: "Remote directory is not writable",
  "ssh-unavailable": "SSH is unavailable",
  "outdated-daemon": "Remote service needs an update",
  configuration: "Server configuration needs attention",
  unsupported: "Remote platform is not supported",
  "unsupported-protocol": "Remote protocol is not supported",
} satisfies Record<BlockedDiagnosis["reason"], string>;

export function describeBlocked(diagnosis: BlockedDiagnosis, target: EnvironmentView): BlockedDiagnosisView {
  const view: BlockedDiagnosisView = {
    reason: diagnosis.reason,
    title: diagnosisTitles[diagnosis.reason],
    detail: diagnosis.detail,
    targetLabel: target.label,
    fields: [],
    action: null,
  };
  switch (diagnosis.reason) {
    case "authentication":
      return {
        ...view,
        action:
          diagnosis.copyIdCommand === null
            ? null
            : { kind: "copy", text: diagnosis.copyIdCommand, purpose: "authentication" },
      };
    case "missing-node":
      return {
        ...view,
        fields: [{ kind: "required-version", value: diagnosis.required.range }],
        action: { kind: "copy", text: diagnosis.upgradeCommand, purpose: "node-upgrade" },
      };
    case "unsupported-node-version":
      return {
        ...view,
        fields: [
          { kind: "detected-version", value: diagnosis.detectedVersion },
          { kind: "required-version", value: diagnosis.required.range },
        ],
        action: { kind: "copy", text: diagnosis.upgradeCommand, purpose: "node-upgrade" },
      };
    case "host-key-changed": {
      const fields: BlockedDiagnosisField[] = [{ kind: "known-host", value: diagnosis.knownHost }];
      if (diagnosis.fingerprint !== null) fields.push({ kind: "fingerprint", value: diagnosis.fingerprint });
      if (diagnosis.knownHostsFile !== undefined)
        fields.push({ kind: "known-hosts-file", value: diagnosis.knownHostsFile });
      return {
        ...view,
        fields,
        action: { kind: "trust", trust: "host-key", fingerprint: diagnosis.fingerprint },
      };
    }
    case "identity-mismatch":
      return {
        ...view,
        fields: [
          { kind: "expected-id", value: diagnosis.expectedEnvironmentId },
          { kind: "actual-id", value: diagnosis.actualEnvironmentId },
        ],
        action: { kind: "trust", trust: "environment-identity", fingerprint: null },
      };
    case "permission":
      return {
        ...view,
        fields: [{ kind: "path", value: diagnosis.path }],
        action: { kind: "edit-field", field: "remoteStateDir", suggestedValue: diagnosis.suggestedStateDir },
      };
    case "outdated-daemon":
      return {
        ...view,
        fields: [{ kind: "protocol", value: String(diagnosis.remoteProtocolVersion) }],
      };
    case "ssh-unavailable":
    case "configuration":
    case "unsupported":
    case "unsupported-protocol":
      return view;
  }
}

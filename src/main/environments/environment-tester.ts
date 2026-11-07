import type { EnvironmentDraft, ProbeReport } from "../../contract/environment-commands.ts";
import { runtimeDiagnosis } from "./remote-probe.ts";
import { fetchUnauthenticatedDescriptor, openRemoteConnection, resolveWebSocketTarget } from "./remote-endpoint.ts";
import type { SshEnvironmentManager } from "./ssh-tunnel-manager.ts";
import type { StoredEnvironment } from "./environment-store.ts";
import { classifyConnectError, diagnosisForReason, EnvironmentConnectionError } from "./supervisor-policy.ts";
export async function testEnvironment(
  subject: EnvironmentDraft | StoredEnvironment,
  ssh: SshEnvironmentManager,
  signal?: AbortSignal,
): Promise<ProbeReport> {
  const start = Date.now();
  const report: ProbeReport = {
    steps: [1, 2, 3, 4].map((step) => ({ step: step as 1 | 2 | 3 | 4, outcome: "skipped" })),
    latencyMs: null,
    nodeVersion: null,
    daemon: null,
    failure: null,
  };
  let step = 0;
  try {
    if (subject.target.kind === "ssh") {
      const probe = await ssh.probe(subject.target, signal, (stage) => {
        if (stage === "checking-runtime") {
          report.steps[0].outcome = "passed";
          step = 1;
        }
      });
      report.steps[0].outcome = "passed";
      step = 1;
      report.nodeVersion = probe.node?.version ?? probe.nodes[0]?.version ?? null;
      report.daemon = {
        running: probe.daemon.running,
        since: probe.daemon.since,
        ownership: probe.daemon.ownership,
        payloadVersion: probe.daemon.payloadVersion,
      };
      const diagnosis = runtimeDiagnosis(probe);
      if (diagnosis) throw new EnvironmentConnectionError("blocked", diagnosis.reason, diagnosis.detail, diagnosis);
      report.steps[1].outcome = "passed";
    } else {
      const endpoint = resolveWebSocketTarget(subject.target, subject.authToken);
      const descriptor = await fetchUnauthenticatedDescriptor(
        endpoint.httpBaseUrl,
        "expectedEnvironmentId" in subject.target ? subject.target.expectedEnvironmentId : undefined,
        undefined,
        signal,
      );
      report.steps[0].outcome = "passed";
      step = 1;
      const connection = await openRemoteConnection(endpoint, descriptor, signal);
      try {
        await connection.rpc.call("host.ping");
      } finally {
        connection.close();
      }
      report.steps[1].outcome = "passed";
      report.nodeVersion = descriptor.runtime?.nodeVersion ?? null;
      report.daemon = {
        running: true,
        since: descriptor.runtime?.startedAt ?? null,
        ownership: "external",
        payloadVersion: descriptor.runtime?.payloadVersion ?? null,
      };
    }
    report.latencyMs = Date.now() - start;
  } catch (error) {
    report.steps[step].outcome = "failed";
    const classified = classifyConnectError(error);
    report.failure =
      classified.kind === "blocked"
        ? {
            kind: "blocked",
            diagnosis:
              error instanceof EnvironmentConnectionError && error.diagnosis
                ? error.diagnosis
                : diagnosisForReason(classified.reason, classified.message),
          }
        : { kind: "transient", failure: { reason: classified.reason, detail: classified.message } };
  }
  return report;
}

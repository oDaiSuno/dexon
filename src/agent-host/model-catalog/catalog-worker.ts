import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import {
  CATALOG_RESULT_MARKER,
  parseCatalogJob,
  resolveCatalogModels,
  type CatalogJobResult,
  type CatalogSnapshot,
} from "./catalog-protocol.ts";

async function buildCatalog(input: unknown): Promise<CatalogSnapshot> {
  const job = parseCatalogJob(input);
  process.chdir(job.cwd);
  process.env.PI_CODING_AGENT_DIR = job.agentDir;
  if (job.offline) process.env.PI_OFFLINE = "1";
  else delete process.env.PI_OFFLINE;
  const { modelRuntime } = await createAgentSessionServices({ cwd: job.cwd, agentDir: job.agentDir });
  let status: CatalogSnapshot["status"] = {
    source: job.offline ? "offline" : "cache",
    refreshed: false,
    aborted: false,
    warnings: [],
  };
  if (job.kind === "refresh" && !job.offline) {
    const result = await modelRuntime.refresh({ allowNetwork: true, force: true });
    status = {
      source: "network",
      refreshed: !result.aborted,
      aborted: result.aborted,
      warnings: [...result.errors.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((provider) => ({
          provider,
          code: "PROVIDER_REFRESH_FAILED",
          message: `Unable to refresh the ${provider} model catalog; cached models remain available.`,
        })),
    };
  }
  const { models, warnings } = await resolveCatalogModels(modelRuntime);
  return {
    cwd: job.cwd,
    models,
    warnings,
    providerIds: modelRuntime.getProviders().map((provider) => provider.id),
    status,
    builtAt: Date.now(),
  };
}

async function main(): Promise<void> {
  let result: CatalogJobResult;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 64 * 1024) throw new Error("Model catalog job is too large");
      chunks.push(buffer);
    }
    result = { ok: true, snapshot: await buildCatalog(JSON.parse(Buffer.concat(chunks).toString("utf8"))) };
  } catch {
    result = { ok: false };
  }
  const encoded = Buffer.from(JSON.stringify(result)).toString("base64");
  process.stdout.write(`\n${CATALOG_RESULT_MARKER}${encoded}\n`, () => process.exit(0));
}

void main();

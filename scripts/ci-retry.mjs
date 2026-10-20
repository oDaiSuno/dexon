import { setTimeout as delay } from "node:timers/promises";

export function workflowWarning(message) {
  const escaped = String(message).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return `::warning::${escaped}`;
}

function describeFailure(error) {
  const code = error?.code ?? error?.cause?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code ? `${code}: ${message}` : message;
}

export async function retry(
  label,
  operation,
  {
    retryDelaysMs = [5_000, 15_000],
    shouldRetry = () => true,
    warn = (message) => console.log(workflowWarning(message)),
  } = {},
) {
  const attempts = retryDelaysMs.length + 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      const waitMs = retryDelaysMs[attempt - 1];
      warn(`${label} failed on attempt ${attempt}/${attempts} (${describeFailure(error)}); retrying in ${waitMs} ms`);
      await delay(waitMs);
    }
  }
}

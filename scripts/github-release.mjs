export async function releaseRequest(endpoint, options = {}) {
  const { allowNotFound = false, ...request } = options;
  const url = new URL(endpoint, "https://api.github.com");
  if (!["https://api.github.com", "https://uploads.github.com"].includes(url.origin)) {
    throw new Error("Release requests must stay on GitHub's official API origins");
  }
  const response = await globalThis.fetch(url, {
    ...request,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
      ...request.headers,
    },
    signal: globalThis.AbortSignal.timeout(240_000),
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok)
    throw new Error(`GitHub release request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response.status === 204 ? null : response.json();
}

export function getExistingRelease(repository, tag) {
  return releaseRequest(`/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, { allowNotFound: true });
}

export function assertDraftRelease(release) {
  if (release?.draft !== true)
    throw new Error(
      "Release is already public or is not a verified draft; use a new version instead of replacing assets",
    );
}

export function createReleaseDraft(repository, tag) {
  return releaseRequest(`/repos/${repository}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      draft: true,
      prerelease: false,
      generate_release_notes: true,
      body: "macOS: **Unsigned Beta** — ad-hoc signed only, with no Developer ID signature and not notarized by Apple. If macOS blocks the first launch, open System Settings → Privacy & Security and choose Open Anyway; automatic update installation is not guaranteed.\n\nWindows: **Unsigned Beta — Unknown Publisher**. Do not describe this as a certificate-backed trusted Windows build.\n\nFinal installation files were verified without rebuilding or resigning. Candidate manifests record their SHA-256 digests and CI identity. Installer lifecycle coverage is not a test of in-app update discovery or download.\n\nReview the successful workflow and enable immutable releases before publishing this draft.",
    }),
  });
}

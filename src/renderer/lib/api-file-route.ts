import { getEnvironmentApiClient } from "./api-client";

export function fileTargetFromUrl(url: URL) {
  const rawPath = url.pathname
    .replace(/^\/api\/files/, "")
    .split("/")
    .map(decodeURIComponent)
    .join("/");
  const path = /^\/[A-Za-z]:\//.test(rawPath) ? rawPath.slice(1) : rawPath;
  const environmentId = url.searchParams.get("environment");
  if (!environmentId) throw new Error("File environment is required");
  return {
    api: getEnvironmentApiClient(environmentId),
    path,
    sourceSessionId: url.searchParams.get("sessionId") ?? undefined,
  };
}

export async function fetchFileRoute(url: URL): Promise<Response> {
  const { api, path, sourceSessionId } = fileTargetFromUrl(url);
  const type = url.searchParams.get("type") ?? "list";
  const params = { path, sourceSessionId };
  let data: unknown;
  if (type === "list") data = await api.listFiles(path);
  else if (type === "read") data = await api.readFile(path, sourceSessionId);
  else if (type === "meta") data = await api.call("files.meta", params);
  else if (type === "preview") data = await api.call("files.preview", params);
  else if (type === "download") {
    const content = await api.call("files.download", params);
    const binary = atob(content.base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new Response(bytes, { headers: { "Content-Type": content.mime } });
  } else {
    return Response.json({ error: "Unknown file operation" }, { status: 400 });
  }
  return Response.json(data);
}

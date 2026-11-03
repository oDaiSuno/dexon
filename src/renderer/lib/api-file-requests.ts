import { call, fileIndex, fileMeta, listFiles, readFile } from "./api-client";

export function decodeApiFilePath(segments: string[]): string {
  const decoded = segments.map(decodeURIComponent).join("/");
  if (decoded.startsWith("ssh://")) return decoded;
  const rawPath = "/" + decoded;
  return rawPath.match(/^\/[A-Za-z]:\//) ? rawPath.slice(1) : rawPath;
}

export async function apiFileRequest(segments: string[], url: URL, method: string): Promise<Response | null> {
  if (segments[0] === "file-index" && method === "GET") {
    const root = url.searchParams.get("cwd") ?? url.searchParams.get("root") ?? "";
    const query = url.searchParams.get("q") ?? undefined;
    return Response.json(await fileIndex(root, query));
  }
  if (segments[0] !== "files") return null;
  const filePath = decodeApiFilePath(segments.slice(1));
  const type = url.searchParams.get("type") ?? "list";
  const sourceSessionId = url.searchParams.get("sessionId") ?? undefined;
  if (type === "list") return Response.json(await listFiles(filePath));
  if (type === "read") return Response.json(await readFile(filePath, sourceSessionId));
  if (type === "meta") return Response.json(await fileMeta(filePath, sourceSessionId));
  if (type === "preview") return Response.json(await call("files.preview", { path: filePath, sourceSessionId }));
  if (type === "download") {
    const content = await call("files.download", { path: filePath, sourceSessionId });
    const binary = atob(content.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Response(bytes, { status: 200, headers: { "Content-Type": content.mime } });
  }
  return null;
}

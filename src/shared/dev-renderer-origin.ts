export const DEFAULT_DEV_RENDERER_PORT = 5173;
export const DEV_RENDERER_PORT_ARGUMENT = "--dexon-dev-renderer-port=";

export function resolveDevRendererPort(raw: string | undefined): number {
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_DEV_RENDERER_PORT;
}

export function readDevRendererPortArgument(argv: readonly string[]): number {
  const argument = argv.find((value) => value.startsWith(DEV_RENDERER_PORT_ARGUMENT));
  return resolveDevRendererPort(argument?.slice(DEV_RENDERER_PORT_ARGUMENT.length));
}

export function isDevRendererOrigin(url: URL, port: number): boolean {
  return (
    url.protocol === "http:" &&
    url.port === String(port) &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

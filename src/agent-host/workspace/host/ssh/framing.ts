export const FRAME_KINDS = {
  request: 1,
  result: 2,
  data: 3,
  failure: 4,
  heartbeat: 5,
  hello: 6,
  cancel: 7,
} as const;

export type FrameKind = keyof typeof FRAME_KINDS;

const KIND_BY_CODE = new Map<number, FrameKind>(
  (Object.entries(FRAME_KINDS) as [FrameKind, number][]).map(([kind, code]) => [code, kind]),
);

export const MAX_FRAME_BYTES = 192 * 1024 * 1024;
const EMPTY = Buffer.alloc(0);

export class FramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FramingError";
  }
}

export interface Frame {
  readonly kind: FrameKind;
  readonly header: Record<string, unknown>;
  readonly payload: Buffer;
}

export interface BlobRef {
  readonly name: string;
  readonly length: number;
}

export function encodeFrame(kind: FrameKind, header: Record<string, unknown>, payload: Buffer = EMPTY): Buffer {
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const bodyLength = 1 + 4 + headerBytes.length + payload.length;
  if (bodyLength > MAX_FRAME_BYTES) throw new FramingError("Frame exceeds the maximum size");
  const out = Buffer.allocUnsafe(4 + bodyLength);
  out.writeUInt32BE(bodyLength, 0);
  out.writeUInt8(FRAME_KINDS[kind], 4);
  out.writeUInt32BE(headerBytes.length, 5);
  headerBytes.copy(out, 9);
  payload.copy(out, 9 + headerBytes.length);
  return out;
}

function parseBody(body: Buffer): Frame {
  const kind = KIND_BY_CODE.get(body.readUInt8(0));
  if (!kind) throw new FramingError("Unknown frame kind");
  const headerLength = body.readUInt32BE(1);
  if (5 + headerLength > body.length) throw new FramingError("Frame header overruns the frame");
  let header: unknown;
  try {
    header = JSON.parse(body.subarray(5, 5 + headerLength).toString("utf8"));
  } catch {
    throw new FramingError("Frame header is not valid JSON");
  }
  if (typeof header !== "object" || header === null || Array.isArray(header)) {
    throw new FramingError("Frame header must be a JSON object");
  }
  return { kind, header: header as Record<string, unknown>, payload: body.subarray(5 + headerLength) };
}

export class FrameDecoder {
  private chunks: Buffer[] = [];
  private size = 0;

  push(chunk: Buffer): Frame[] {
    this.chunks.push(chunk);
    this.size += chunk.length;
    const frames: Frame[] = [];
    while (this.size >= 4) {
      const bodyLength = this.peek(4).readUInt32BE(0);
      if (bodyLength < 5 || bodyLength > MAX_FRAME_BYTES) throw new FramingError("Invalid frame length");
      if (this.size < 4 + bodyLength) break;
      frames.push(parseBody(this.take(4 + bodyLength).subarray(4)));
    }
    return frames;
  }

  private coalesce(): void {
    if (this.chunks.length > 1) this.chunks = [Buffer.concat(this.chunks)];
  }

  private peek(count: number): Buffer {
    if (this.chunks[0].length < count) this.coalesce();
    return this.chunks[0].subarray(0, count);
  }

  private take(count: number): Buffer {
    if (this.chunks[0].length < count) this.coalesce();
    const head = this.chunks[0];
    const taken = head.subarray(0, count);
    if (head.length === count) this.chunks.shift();
    else this.chunks[0] = head.subarray(count);
    this.size -= count;
    return taken;
  }
}

export function splitBlobs(input: object): { json: Record<string, unknown>; blobs: BlobRef[]; payload: Buffer } {
  const json: Record<string, unknown> = {};
  const blobs: BlobRef[] = [];
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(input)) {
    if (value instanceof Uint8Array) {
      const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      blobs.push({ name, length: bytes.length });
      parts.push(bytes);
    } else {
      json[name] = value;
    }
  }
  return { json, blobs, payload: parts.length ? Buffer.concat(parts) : EMPTY };
}

export function joinBlobs(json: Record<string, unknown>, blobs: unknown, payload: Buffer): Record<string, unknown> {
  const joined: Record<string, unknown> = { ...json };
  let offset = 0;
  for (const ref of Array.isArray(blobs) ? (blobs as BlobRef[]) : []) {
    if (typeof ref?.name !== "string" || !Number.isSafeInteger(ref.length) || offset + ref.length > payload.length) {
      throw new FramingError("Blob table does not match the payload");
    }
    joined[ref.name] = Buffer.from(payload.subarray(offset, offset + ref.length));
    offset += ref.length;
  }
  return joined;
}

export function encodeRequest(id: number, epoch: number, op: string, input: object): Buffer {
  const { json, blobs, payload } = splitBlobs(input);
  return encodeFrame("request", { id, epoch, op, input: json, blobs }, payload);
}

export function encodeCancel(id: number): Buffer {
  return encodeFrame("cancel", { id });
}

export function encodeHeartbeat(extra: Record<string, unknown> = {}): Buffer {
  return encodeFrame("heartbeat", extra);
}

export type HelperMessage =
  | { readonly kind: "hello"; readonly version: number; readonly python: string; readonly pid: number }
  | { readonly kind: "result"; readonly id: number; readonly body: Record<string, unknown> }
  | {
      readonly kind: "data";
      readonly id: number;
      readonly stream: string;
      readonly meta: Record<string, unknown>;
      readonly bytes: Buffer;
    }
  | { readonly kind: "failure"; readonly id: number; readonly code: string; readonly message: string }
  | { readonly kind: "heartbeat" };

function integerField(header: Record<string, unknown>, name: string): number {
  const value = header[name];
  if (!Number.isSafeInteger(value)) throw new FramingError(`Frame header field ${name} must be an integer`);
  return value as number;
}

function stringField(header: Record<string, unknown>, name: string): string {
  const value = header[name];
  if (typeof value !== "string") throw new FramingError(`Frame header field ${name} must be a string`);
  return value;
}

export function interpretHelperFrame(frame: Frame): HelperMessage {
  const { header, payload } = frame;
  switch (frame.kind) {
    case "hello":
      return {
        kind: "hello",
        version: integerField(header, "version"),
        python: stringField(header, "python"),
        pid: integerField(header, "pid"),
      };
    case "result": {
      const body = header.body;
      if (typeof body !== "object" || body === null) throw new FramingError("Result frame is missing its body");
      return {
        kind: "result",
        id: integerField(header, "id"),
        body: joinBlobs(body as Record<string, unknown>, header.blobs, payload),
      };
    }
    case "data": {
      const meta = header.meta;
      return {
        kind: "data",
        id: integerField(header, "id"),
        stream: stringField(header, "stream"),
        meta: typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>) : {},
        bytes: Buffer.from(payload),
      };
    }
    case "failure":
      return {
        kind: "failure",
        id: integerField(header, "id"),
        code: stringField(header, "code"),
        message: stringField(header, "message"),
      };
    case "heartbeat":
      return { kind: "heartbeat" };
    default:
      throw new FramingError(`Unexpected ${frame.kind} frame from the helper`);
  }
}

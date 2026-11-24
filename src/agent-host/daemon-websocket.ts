import { isUtf8 } from "node:buffer";
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import type { WebSocketLike } from "../contract/rpc-channel.ts";

const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const MAX_MESSAGE_FRAGMENTS = 65536;
const MAX_OUTBOUND_BUFFER_BYTES = 128 * 1024 * 1024;
const MAX_PAUSE_MS = 1000;

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const prefix = payload.length < 126 ? 2 : payload.length <= 0xffff ? 4 : 10;
  const frame = Buffer.allocUnsafe(prefix + payload.length);
  frame[0] = 0x80 | opcode;
  if (prefix === 2) frame[1] = payload.length;
  else if (prefix === 4) {
    frame[1] = 126;
    frame.writeUInt16BE(payload.length, 2);
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  payload.copy(frame, prefix);
  return frame;
}

function validCloseCode(code: number): boolean {
  return (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999);
}

export class DaemonWebSocket extends EventEmitter implements WebSocketLike {
  readyState = 1;
  private buffered: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private messageBytes = 0;
  private fragmentType: number | undefined;
  private paused = false;
  private pauseTimer: NodeJS.Timeout | undefined;

  private readonly socket: Socket;
  private readonly binary: boolean;

  constructor(socket: Socket, binary = false) {
    super();
    this.socket = socket;
    this.binary = binary;
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
    socket.on("drain", () => this.emit("drain"));
    socket.once("end", () => socket.destroy());
    socket.on("error", (error) => {
      socket.destroy();
      if (this.listenerCount("error") > 0) this.emit("error", error);
    });
    socket.once("close", () => {
      this.readyState = 3;
      this.buffered = Buffer.alloc(0);
      this.fragments = [];
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
      this.emit("close");
    });
  }

  send(data: string | Buffer): boolean {
    if (this.readyState !== 1) throw new Error("WebSocket is not open");
    if (!this.enqueueFrame(typeof data === "string" ? 1 : 2, data)) {
      throw new Error("WebSocket outbound buffer limit exceeded");
    }
    return !this.socket.writableNeedDrain;
  }

  pause(): void {
    if (this.readyState !== 1) return;
    this.paused = true;
    clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => this.socket.destroy(), MAX_PAUSE_MS);
    this.pauseTimer.unref();
    this.socket.pause();
  }

  resume(): void {
    if (this.readyState !== 1) return;
    this.paused = false;
    clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
    this.receive(Buffer.alloc(0));
    if (!this.paused) this.socket.resume();
  }

  private enqueueFrame(opcode: number, payload: string | Buffer): boolean {
    if (this.socket.writableLength + Buffer.byteLength(payload) + 10 > MAX_OUTBOUND_BUFFER_BYTES) {
      this.close(1013);
      return false;
    }
    this.socket.write(encodeFrame(opcode, typeof payload === "string" ? Buffer.from(payload, "utf8") : payload));
    return true;
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState !== 1) return;
    const text = Buffer.from(reason, "utf8");
    if (!validCloseCode(code) || text.length > 123) throw new Error("Invalid WebSocket close payload");
    const payload = Buffer.allocUnsafe(2 + text.length);
    payload.writeUInt16BE(code);
    text.copy(payload, 2);
    this.end(payload);
  }

  private end(payload: Buffer): void {
    this.readyState = 2;
    clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
    this.socket.resume();
    this.buffered = Buffer.alloc(0);
    this.fragments = [];
    if (this.socket.destroyed) return;
    this.socket.end(encodeFrame(8, payload));
    const timer = setTimeout(() => this.socket.destroy(), 1000);
    timer.unref();
    this.socket.once("close", () => clearTimeout(timer));
  }

  receive(chunk: Buffer): void {
    if (this.readyState !== 1) return;
    if (this.buffered.length + this.messageBytes + chunk.length > MAX_MESSAGE_BYTES + 65536 + 14) {
      this.close(1009);
      return;
    }
    if (chunk.length) this.buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk]) : chunk;
    while (this.readyState === 1 && !this.paused && this.buffered.length >= 2) {
      const first = this.buffered[0]!;
      const second = this.buffered[1]!;
      const final = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      if ((first & 0x70) !== 0 || (second & 0x80) === 0 || ![0, 1, 2, 8, 9, 10].includes(opcode)) {
        this.close(1002);
        return;
      }
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffered.length < 4) return;
        length = this.buffered.readUInt16BE(2);
        offset = 4;
        if (length < 126) {
          this.close(1002);
          return;
        }
      } else if (length === 127) {
        if (this.buffered.length < 10) return;
        const wideLength = this.buffered.readBigUInt64BE(2);
        if (wideLength > BigInt(MAX_MESSAGE_BYTES)) {
          this.close(1009);
          return;
        }
        length = Number(wideLength);
        offset = 10;
        if (length <= 0xffff) {
          this.close(1002);
          return;
        }
      }
      const control = opcode >= 8;
      if (control && (!final || length > 125)) {
        this.close(1002);
        return;
      }
      if (
        !control &&
        ((opcode === 0 && this.fragmentType === undefined) || (opcode !== 0 && this.fragmentType !== undefined))
      ) {
        this.close(1002);
        return;
      }
      if (
        length + (control ? 0 : this.messageBytes) > MAX_MESSAGE_BYTES ||
        (!control && this.fragments.length >= MAX_MESSAGE_FRAGMENTS)
      ) {
        this.close(1009);
        return;
      }
      if (this.buffered.length < offset + 4 + length) return;
      const mask = this.buffered.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(this.buffered.subarray(offset, offset + length));
      for (let index = 0; index < payload.length; index += 1) payload[index] = payload[index]! ^ mask[index % 4]!;
      this.buffered = this.buffered.subarray(offset + length);
      this.acceptFrame(opcode, final, payload);
    }
  }

  private acceptFrame(opcode: number, final: boolean, payload: Buffer): void {
    if (opcode === 8) {
      if (payload.length === 1 || (payload.length >= 2 && !validCloseCode(payload.readUInt16BE(0)))) {
        this.close(1002);
      } else if (payload.length >= 2 && !isUtf8(payload.subarray(2))) {
        this.close(1007);
      } else {
        this.end(payload);
      }
      return;
    }
    if (opcode === 9) {
      this.enqueueFrame(10, payload);
      return;
    }
    if (opcode === 10) return;
    if (opcode !== 0) this.fragmentType = opcode;
    if (this.fragmentType === 2 && !this.binary) {
      this.close(1003);
      return;
    }
    this.fragments.push(payload);
    this.messageBytes += payload.length;
    if (!final) return;
    const message = this.fragments.length === 1 ? payload : Buffer.concat(this.fragments, this.messageBytes);
    const binary = this.fragmentType === 2;
    this.fragments = [];
    this.messageBytes = 0;
    this.fragmentType = undefined;
    if (!binary && !isUtf8(message)) this.close(1007);
    else this.emit("message", binary ? message : message.toString("utf8"));
  }
}

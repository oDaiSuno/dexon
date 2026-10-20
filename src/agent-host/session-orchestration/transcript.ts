import { rmSync } from "node:fs";
import path from "node:path";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import type { SessionLiveStatus } from "../../shared/session-orchestration";
import type { AgentMessage, AssistantContentBlock, ToolResultMessage, UserMessage } from "../../shared/types";
import { atomicWriteText, desktopUserDataPath } from "../desktop-state-file";
import { messageContentText } from "../session-title";

export interface TranscriptSummary {
  path: string;
  messages: number;
  lines: number;
  bytes: number;
}

export interface TranscriptSnapshot {
  sessionId: string;
  title: string;
  cwd: string;
  status: SessionLiveStatus | "idle";
  createdBySessionId?: string;
  messages: AgentMessage[];
}

const TRANSCRIPT_DIRECTORY = "session-transcripts";

export function sessionTranscriptPath(sessionId: string): string {
  return path.join(desktopUserDataPath(), TRANSCRIPT_DIRECTORY, `${sessionId}.md`);
}

export function removeSessionTranscript(sessionId: string): void {
  rmSync(sessionTranscriptPath(sessionId), { force: true });
}

export function limitReply(reply: string): { lastReply: string; lastReplyTruncated: boolean } {
  const limited = truncateHead(reply);
  return { lastReply: limited.content, lastReplyTruncated: limited.truncated };
}

export function writeSessionTranscript(snapshot: TranscriptSnapshot): TranscriptSummary {
  const transcript = renderTranscript(snapshot);
  const filePath = sessionTranscriptPath(snapshot.sessionId);
  atomicWriteText(filePath, transcript);
  return {
    path: filePath,
    messages: snapshot.messages.length,
    lines: transcript.split("\n").length,
    bytes: Buffer.byteLength(transcript, "utf8"),
  };
}

function renderTranscript(snapshot: TranscriptSnapshot): string {
  const header = [
    `# ${snapshot.title}`,
    `- Session: ${snapshot.sessionId}`,
    `- Directory: ${snapshot.cwd}`,
    `- Status: ${snapshot.status}`,
    ...(snapshot.createdBySessionId ? [`- Created by: ${snapshot.createdBySessionId}`] : []),
    `- Snapshot: ${new Date().toISOString()}`,
  ];
  const sections = snapshot.messages.map((message, index) => renderSection(message, index + 1));
  return [header.join("\n"), ...sections].join("\n\n").trimEnd();
}

function renderSection(message: AgentMessage, number: number): string {
  switch (message.role) {
    case "user":
      return section(`${heading(number, "User")}${userOrigin(message)}`, userText(message));
    case "assistant":
      return section(heading(number, "Assistant"), message.content.map(renderAssistantBlock).join("\n\n"));
    case "toolResult":
      return section(toolResultHeading(message, number), fenced(toolResultText(message)));
    default:
      return section(heading(number, message.customType), messageContentText(message.content).trim());
  }
}

function heading(number: number, title: string): string {
  return `## [${number}] ${title}`;
}

function userOrigin(message: UserMessage): string {
  const source = message.sessionSource;
  return source ? ` — from session ${source.title ?? source.sessionId}` : "";
}

function userText(message: UserMessage): string {
  return [messageContentText(message.content).trim(), ...imagePlaceholders(message.content)]
    .filter((part) => part)
    .join("\n");
}

function imagePlaceholders(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => (part as { type?: unknown })?.type === "image").map(() => "[image]");
}

function renderAssistantBlock(block: AssistantContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "thinking":
      return ["Thinking:", ...block.thinking.split("\n").map((line) => `> ${line}`)].join("\n");
    case "toolCall":
      return [`Tool call: ${block.toolName}`, fenced(prettyJson(block.input), "json")].join("\n");
    default:
      return "[image]";
  }
}

function toolResultHeading(message: ToolResultMessage, number: number): string {
  return heading(number, `Tool result: ${message.toolName ?? "tool"}${message.isError ? " (error)" : ""}`);
}

function toolResultText(message: ToolResultMessage): string {
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return [text, ...imagePlaceholders(message.content)].join("\n").trim();
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function fenced(text: string, language = ""): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function longestBacktickRun(text: string): number {
  return text.split(/[^`]+/).reduce((longest, run) => Math.max(longest, run.length), 0);
}

function section(title: string, body: string): string {
  return body ? `${title}\n\n${body}` : title;
}

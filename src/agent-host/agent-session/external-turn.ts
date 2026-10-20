import type { ChannelId } from "../../shared/channel-types";
import type { AgentSessionLike } from "../../shared/pi-types";
import type { ChannelMessageAttachment } from "../../shared/types";
import { browserAgentRuntime } from "../browser-agent-runtime";
import { CHANNEL_SOURCE_CANCELLED_TYPE, CHANNEL_SOURCE_TYPE } from "../session-entry-compat";
import type { AgentEvent } from "./types";

export interface ExternalTurnParams {
  runId: string;
  message: string;
  channel: ChannelId;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
  channelAttachments?: ChannelMessageAttachment[];
  attachmentContext?: string;
  onProgress?: (event: AgentEvent) => void;
}

export interface ExternalTurnContext {
  channel: ChannelId;
  attachments: ChannelMessageAttachment[] | null;
  progress: ((event: AgentEvent) => void) | null;
}

export interface ExternalTurnHost {
  readonly inner: AgentSessionLike;
  readonly sessionId: string;
  enqueueTurn<T>(task: () => Promise<T>): Promise<T>;
  emit(event: AgentEvent): void;
  beginExternalTurn(context: ExternalTurnContext): void;
  endExternalTurn(): void;
  setBrowserSource(source: "local" | "channel"): void;
}

export function runExternalTurn(
  host: ExternalTurnHost,
  params: ExternalTurnParams,
): Promise<{ runId: string; finalText: string }> {
  return host.enqueueTurn(async () => {
    host.emit({ type: "channel_turn_start", runId: params.runId });
    host.beginExternalTurn({
      channel: params.channel,
      attachments: params.channelAttachments ?? null,
      progress: params.onProgress ?? null,
    });
    host.setBrowserSource("channel");
    browserAgentRuntime.beginTurn(host.sessionId, "channel");
    try {
      host.inner.sessionManager.appendCustomEntry(CHANNEL_SOURCE_TYPE, {
        runId: params.runId,
        channel: params.channel,
        ...(params.channelAttachments?.length ? { attachments: params.channelAttachments } : {}),
      });
      if (params.attachmentContext) {
        await host.inner.sendCustomMessage(
          {
            customType: "dexon-channel-attachment-context",
            content: params.attachmentContext,
            display: false,
          },
          { deliverAs: "nextTurn" },
        );
      }
      await host.inner.prompt(params.message, {
        ...(params.images?.length ? { images: params.images } : {}),
        expandPromptTemplates: false,
        source: "rpc",
      });
      const finalText = host.inner.getLastAssistantText()?.trim() ?? "";
      host.emit({ type: "channel_turn_end", runId: params.runId, finalText });
      return { runId: params.runId, finalText };
    } catch (error) {
      try {
        host.inner.sessionManager.appendCustomEntry(CHANNEL_SOURCE_CANCELLED_TYPE, { runId: params.runId });
      } catch {
        // A best-effort UI marker must never hide the original turn failure.
      }
      host.emit({
        type: "channel_turn_error",
        runId: params.runId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      host.endExternalTurn();
      host.setBrowserSource("local");
    }
  });
}

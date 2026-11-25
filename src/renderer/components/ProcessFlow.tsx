import type { LiveToolUpdate } from "@/hooks/agent-session/shared";
import type { EnvironmentId } from "@contract/environment";
import { Fragment } from "react";
import type { ProcessFlowItem } from "@/lib/process-flow";
import type { AssistantMessage } from "@/lib/types";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { CompactionMessageView, CustomMessageView } from "./messages/SystemMessages";
import { StreamSpeedHint } from "./messages/StreamSpeedHint";
import { DeferredContentActions } from "./messages/shared";
import { ThinkingBlock } from "./messages/ThinkingBlock";
import { ToolCallBlock } from "./messages/ToolCallBlock";

export function ProcessFlow({
  environmentId,
  items,
  liveToolUpdates,
  cwd,
  onOpenFile,
  onLoadDeferredContent,
  thinkingExpansionStore,
  unanswered,
  speedHint,
  quoteStreamingEntryId,
}: {
  environmentId: EnvironmentId;
  items: ProcessFlowItem[];
  liveToolUpdates?: ReadonlyMap<string, LiveToolUpdate>;
  cwd?: string;
  onOpenFile?: (filePath: string, environmentId?: EnvironmentId) => void;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  thinkingExpansionStore?: ThinkingExpansionStore;
  unanswered?: boolean;
  speedHint?: AssistantMessage;
  quoteStreamingEntryId?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {speedHint && <StreamSpeedHint message={speedHint} />}
      {items.map((item) => {
        switch (item.kind) {
          case "thinking":
            return (
              <div
                key={item.key}
                data-quote-entry-id={item.entryId ?? ""}
                data-quote-role="assistant"
                data-quote-streaming={
                  quoteStreamingEntryId !== undefined && (item.entryId ?? "") === quoteStreamingEntryId
                    ? "true"
                    : undefined
                }
              >
                <ThinkingBlock
                  block={item.block}
                  duration={item.duration}
                  stateKey={`${item.entryId ?? "assistant"}:${item.blockIndex}`}
                  store={thinkingExpansionStore}
                  unanswered={unanswered}
                  streaming={item.streaming}
                />
                <DeferredContentActions content={[item.block]} onLoad={onLoadDeferredContent} />
              </div>
            );
          case "toolCall":
            return (
              <div
                key={item.key}
                data-quote-entry-id={item.entryId ?? ""}
                data-quote-role="assistant"
                data-quote-streaming={
                  quoteStreamingEntryId !== undefined && (item.entryId ?? "") === quoteStreamingEntryId
                    ? "true"
                    : undefined
                }
              >
                <ToolCallBlock
                  block={item.block}
                  result={item.result}
                  liveUpdate={liveToolUpdates?.get(item.block.toolCallId)}
                  environmentId={environmentId}
                  cwd={cwd}
                  onOpenFile={onOpenFile}
                  duration={item.duration}
                  startedAt={item.startedAt}
                  stateKey={`${item.entryId ?? "assistant"}:${item.blockIndex}`}
                  expansionStore={thinkingExpansionStore}
                  onLoadDeferredContent={onLoadDeferredContent}
                />
                <DeferredContentActions content={[item.block]} onLoad={onLoadDeferredContent} />
              </div>
            );
          case "custom": {
            const view =
              item.message.customType === "compaction" ? (
                <CompactionMessageView environmentId={environmentId} message={item.message} />
              ) : (
                <CustomMessageView
                  environmentId={environmentId}
                  message={item.message}
                  cwd={cwd}
                  onOpenFile={onOpenFile}
                  onLoadDeferredContent={onLoadDeferredContent}
                />
              );
            return (
              <Fragment key={item.key}>
                {view}
                {item.message.customType === "compaction" && (
                  <DeferredContentActions content={item.message.content} onLoad={onLoadDeferredContent} />
                )}
              </Fragment>
            );
          }
        }
      })}
    </div>
  );
}

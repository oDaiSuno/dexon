import { Fragment } from "react";
import type { ProcessFlowItem } from "@/lib/process-flow";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { CompactionMessageView, CustomMessageView } from "./messages/SystemMessages";
import { DeferredContentActions } from "./messages/shared";
import { ThinkingBlock } from "./messages/ThinkingBlock";
import { ToolCallBlock } from "./messages/ToolCallBlock";

/**
 * Continuous process stream inside the collapsed process-details group:
 * thinking rows, tool-call rows and custom messages interleave in the order
 * the agent produced them — no per-message usage lines, no per-message spacing.
 */
export function ProcessFlow({
  items,
  cwd,
  onOpenFile,
  onLoadDeferredContent,
  thinkingExpansionStore,
}: {
  items: ProcessFlowItem[];
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  thinkingExpansionStore?: ThinkingExpansionStore;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {items.map((item) => {
        switch (item.kind) {
          case "thinking":
            return (
              <Fragment key={item.key}>
                <ThinkingBlock
                  block={item.block}
                  duration={item.duration}
                  stateKey={`${item.entryId ?? "assistant"}:${item.blockIndex}`}
                  store={thinkingExpansionStore}
                />
                <DeferredContentActions content={[item.block]} onLoad={onLoadDeferredContent} />
              </Fragment>
            );
          case "toolCall":
            return (
              <Fragment key={item.key}>
                <ToolCallBlock
                  block={item.block}
                  result={item.result}
                  duration={item.duration}
                  onLoadDeferredContent={onLoadDeferredContent}
                />
                <DeferredContentActions content={[item.block]} onLoad={onLoadDeferredContent} />
              </Fragment>
            );
          case "custom": {
            const view =
              item.message.customType === "compaction" ? (
                <CompactionMessageView message={item.message} />
              ) : (
                <CustomMessageView
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

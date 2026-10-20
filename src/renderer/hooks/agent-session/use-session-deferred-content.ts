import { getSessionEntryContent } from "@/lib/api-client";
import { DeferredContentQueue } from "@/lib/deferred-content-queue";
import type { AgentMessage } from "@/lib/types";
import { useCallback, useRef } from "react";
import { DEFERRED_CONTENT_CACHE_SIZE } from "./shared";
import type { SessionHistory } from "./use-session-history";
import type { SessionState } from "./use-session-state";

type Dependencies = Pick<
  SessionState,
  | "sessionIdRef"
  | "historyGenerationRef"
  | "deferredContentCacheRef"
  | "deferredContentRequestRef"
  | "loadedMessagesRef"
  | "loadedEntryIdsRef"
> &
  Pick<SessionHistory, "commitHistory">;

export function useSessionDeferredContent(context: Dependencies) {
  const {
    sessionIdRef,
    historyGenerationRef,
    deferredContentCacheRef,
    deferredContentRequestRef,
    loadedMessagesRef,
    loadedEntryIdsRef,
    commitHistory,
  } = context;

  const queueRef = useRef(new DeferredContentQueue());

  const loadDeferredContent = useCallback(
    async (entryId: string, blockIndex = 0) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const generation = historyGenerationRef.current;
      const cacheKey = `${sid}:${entryId}:${blockIndex}`;
      let loadedContent = deferredContentCacheRef.current.get(cacheKey);
      if (loadedContent === undefined) {
        let request = deferredContentRequestRef.current.get(cacheKey);
        if (!request) {
          request = queueRef.current.run(async () => {
            if (generation !== historyGenerationRef.current || sid !== sessionIdRef.current) return undefined;
            return (await getSessionEntryContent(sid, entryId, blockIndex)).content;
          });
          deferredContentRequestRef.current.set(cacheKey, request);
        }
        try {
          loadedContent = await request;
        } finally {
          deferredContentRequestRef.current.delete(cacheKey);
        }
        if (loadedContent === undefined) return;
        const cache = deferredContentCacheRef.current;
        cache.delete(cacheKey);
        cache.set(cacheKey, loadedContent);
        while (cache.size > DEFERRED_CONTENT_CACHE_SIZE) cache.delete(cache.keys().next().value!);
      }
      if (generation !== historyGenerationRef.current || sid !== sessionIdRef.current) return;
      const nextMessages = loadedMessagesRef.current.map((message, messageIndex) => {
        if (loadedEntryIdsRef.current[messageIndex] !== entryId || !Array.isArray(message.content)) return message;
        const content = message.content.map((block, index) => {
          if (index !== blockIndex || !("deferredContent" in block)) return block;
          return loadedContent;
        });
        return { ...message, content } as AgentMessage;
      });
      commitHistory(nextMessages, loadedEntryIdsRef.current);
    },
    [
      commitHistory,
      deferredContentCacheRef,
      deferredContentRequestRef,
      historyGenerationRef,
      loadedEntryIdsRef,
      loadedMessagesRef,
      sessionIdRef,
    ],
  );

  return { loadDeferredContent };
}

export type SessionDeferredContent = ReturnType<typeof useSessionDeferredContent>;

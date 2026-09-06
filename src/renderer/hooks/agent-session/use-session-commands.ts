import { sendAgentCommand } from "@/lib/agent-client";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { useCallback } from "react";
import {
  BuiltinSlashCommandResult,
  CompactCommandResult,
  LastAssistantTextResponse,
  readCompactResult,
} from "./shared";
import type { SessionConnection } from "./use-session-connection";
import type { SessionExtensions } from "./use-session-extensions";
import type { SessionHistory } from "./use-session-history";
import type { SessionModels } from "./use-session-models";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<
  SessionState,
  | "sessionIdRef"
  | "t"
  | "isCompacting"
  | "setIsCompacting"
  | "setCompactError"
  | "setCompactResult"
  | "setSessionStatsOverride"
  | "setContextUsage"
  | "onSessionStatsPanelOpen"
> &
  Pick<SessionConnection, "ensureNewSession" | "promoteNewSession" | "loadSlashCommands"> &
  Pick<SessionExtensions, "addNotice"> &
  Pick<SessionHistory, "loadSession"> &
  Pick<SessionModels, "loadModels">;
export function useSessionCommands(context: Dependencies) {
  const {
    sessionIdRef,
    ensureNewSession,
    addNotice,
    t,
    isCompacting,
    setIsCompacting,
    setCompactError,
    setCompactResult,
    loadSession,
    promoteNewSession,
    loadSlashCommands,
    loadModels,
    setSessionStatsOverride,
    setContextUsage,
    onSessionStatsPanelOpen,
  } = context;

  const handleBuiltinSlashCommand = useCallback(
    async (text: string): Promise<BuiltinSlashCommandResult> => {
      if (!text.startsWith("/")) return { handled: false };
      const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
      if (!match) return { handled: false };

      const [, commandName, rawArgs = ""] = match;
      const args = rawArgs.trim();
      const sid = sessionIdRef.current ?? (await ensureNewSession());
      const complete = (result: BuiltinSlashCommandResult): BuiltinSlashCommandResult => {
        if (!result.handled) return result;
        if (result.error) {
          addNotice({ type: "error", message: result.error });
        } else if (result.action !== "openSessionStats") {
          addNotice({ type: "success", message: result.message ?? t("commandCompleted", "Command completed") });
        }
        return result;
      };

      try {
        switch (commandName) {
          case "compact": {
            if (!sid || isCompacting) {
              return complete({
                handled: true,
                error: t("noActiveSessionToCompact", "No active session to compact"),
              });
            }
            setIsCompacting(true);
            setCompactError(null);
            setCompactResult(null);
            const result = await sendAgentCommand<CompactCommandResult>(sid, {
              type: "compact",
              ...(args ? { customInstructions: args } : {}),
            });
            setCompactResult(readCompactResult(result, "manual"));
            if (await loadSession(sid, true, true)) promoteNewSession();
            return complete({ handled: true, message: t("contextCompacted", "Compacted context") });
          }

          case "reload": {
            if (!sid) {
              return complete({ handled: true, error: t("noActiveSessionToReload", "No active session to reload") });
            }
            await sendAgentCommand(sid, { type: "reload" });
            await Promise.all([loadSession(sid, false, true), loadSlashCommands(), loadModels()]);
            return complete({
              handled: true,
              message: t("sessionResourcesReloaded", "Reloaded session resources"),
            });
          }

          case "name": {
            if (!sid) {
              return complete({ handled: true, error: t("noActiveSessionToName", "No active session to name") });
            }
            if (!args) return complete({ handled: true, error: t("nameCommandUsage", "Usage: /name <name>") });
            await sendAgentCommand(sid, { type: "set_session_name", name: args });
            if (await loadSession(sid)) promoteNewSession();
            return complete({
              handled: true,
              message: t("sessionRenamedTo", "Session renamed to {name}").replace("{name}", args),
            });
          }

          case "session": {
            if (!sid) return complete({ handled: true, error: t("noActiveSession", "No active session") });
            const stats = await sendAgentCommand<SessionStatsInfo>(sid, { type: "get_session_stats" });
            if (stats) {
              setSessionStatsOverride(stats);
              // Keep the chip and top bar on the same source of truth.
              if (stats.contextUsage !== undefined) setContextUsage(stats.contextUsage ?? null);
            }
            onSessionStatsPanelOpen?.();
            return complete({ handled: true, action: "openSessionStats" });
          }

          case "copy": {
            if (!sid) return complete({ handled: true, error: t("noActiveSession", "No active session") });
            const data = await sendAgentCommand<LastAssistantTextResponse>(sid, { type: "get_last_assistant_text" });
            const textToCopy = data?.text ?? "";
            if (!textToCopy) {
              return complete({
                handled: true,
                error: t("noAssistantMessageToCopy", "No assistant message to copy"),
              });
            }
            await navigator.clipboard.writeText(textToCopy);
            return complete({
              handled: true,
              message: t("copiedLastAssistantMessage", "Copied last assistant message"),
            });
          }

          default:
            return { handled: false };
        }
      } catch (e) {
        return complete({ handled: true, error: e instanceof Error ? e.message : String(e) });
      } finally {
        if (commandName === "compact") setIsCompacting(false);
      }
    },
    [
      sessionIdRef,
      ensureNewSession,
      addNotice,
      t,
      isCompacting,
      setIsCompacting,
      setCompactError,
      setCompactResult,
      loadSession,
      promoteNewSession,
      loadSlashCommands,
      loadModels,
      onSessionStatsPanelOpen,
      setSessionStatsOverride,
      setContextUsage,
    ],
  );
  return { handleBuiltinSlashCommand };
}
export type SessionCommands = ReturnType<typeof useSessionCommands>;

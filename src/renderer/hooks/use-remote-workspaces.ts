import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { RemoteTrustPromptEvent, RemoteWorkspaceStateSnapshot, WorkspaceTrustMode } from "@contract/workspace";
import type { SshTarget } from "@shared/workspace-ref";
import { describeWorkspaceKey } from "@shared/workspace-ref";
import { useI18n } from "@/i18n";
import { call, subscribe } from "@/lib/api-client";
import { noticeReducer, type NoticeItem } from "@/lib/notice-queue";
import { workspaceFacts, type RemoteWorkspaceStates } from "@/lib/remote-workspace";
import { updateRemoteTrustPrompts } from "@/lib/remote-trust-prompts";
import { useNoticeExpiry } from "./use-notice-expiry";

const REMOTE_NOTICE_MS = 4_000;

export function useRemoteWorkspaces() {
  const { t } = useI18n();
  const [statesByWorkspace, setStatesByWorkspace] = useState<RemoteWorkspaceStates>({});
  const [trustPrompts, setTrustPrompts] = useState<readonly RemoteTrustPromptEvent[]>([]);
  const activeTrustPrompt = trustPrompts.at(-1) ?? null;
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [], pending: [] });
  const noticeSequence = useRef(0);
  useNoticeExpiry(noticeState.visible, dispatchNotice);

  const addNotice = useCallback((notice: Pick<NoticeItem, "message" | "type" | "action">) => {
    dispatchNotice({
      type: "add",
      notice: {
        ...notice,
        id: `remote-workspace-${++noticeSequence.current}`,
        durationMs: REMOTE_NOTICE_MS,
        expiresAt: Date.now() + REMOTE_NOTICE_MS,
      },
    });
  }, []);

  const reportError = useCallback(
    (error: unknown) => {
      addNotice({
        type: "error",
        message: t("sshNoticeOperationFailed", "Could not update the remote workspace. {error}").replace(
          "{error}",
          error instanceof Error ? error.message : String(error),
        ),
      });
    },
    [addNotice, t],
  );

  const rememberState = useCallback((state: RemoteWorkspaceStateSnapshot) => {
    const key = describeWorkspaceKey(state.workspace).workspaceKey;
    setStatesByWorkspace((current) => ({ ...current, [key]: state }));
  }, []);

  const applyResult = useCallback(
    async (request: Promise<{ state: RemoteWorkspaceStateSnapshot }>) => {
      const result = await request;
      rememberState(result.state);
      return result;
    },
    [rememberState],
  );

  const setTrust = useCallback(
    (workspace: string, trust: WorkspaceTrustMode) => applyResult(call("remote.trustSet", { workspace, trust })),
    [applyResult],
  );
  const syncRules = useCallback(
    (workspace: string) => applyResult(call("remote.syncRules", { workspace })),
    [applyResult],
  );
  const reconnect = useCallback(
    (workspace: string) => applyResult(call("remote.reconnect", { workspace })),
    [applyResult],
  );
  const disconnect = useCallback(
    (workspace: string) => applyResult(call("remote.disconnect", { workspace })),
    [applyResult],
  );
  const cleanupRetry = useCallback(
    (workspace: string) => applyResult(call("remote.cleanupRetry", { workspace })),
    [applyResult],
  );
  const resolveTrustPrompt = useCallback(
    async (promptId: string, decision: "trust" | "keep-read-only") => {
      const result = await applyResult(call("remote.trustPromptResolve", { promptId, decision }));
      setTrustPrompts((current) => current.filter((prompt) => prompt.promptId !== promptId));
      return result;
    },
    [applyResult],
  );
  const listHosts = useCallback(() => call("remote.hosts", undefined), []);
  const browseRemote = useCallback((target: SshTarget, path?: string) => call("remote.browse", { target, path }), []);
  const acceptHostKey = useCallback(
    (target: SshTarget, fingerprint: string) => call("remote.acceptHostKey", { target, fingerprint }),
    [],
  );
  const installPython = useCallback((target: SshTarget) => call("remote.installPython", { target }), []);

  useEffect(() => {
    let disposed = false;
    const subscriptions = new Set<() => void>();
    const keepSubscription = (off: () => void) => {
      if (disposed) off();
      else subscriptions.add(off);
    };
    const reportLoadError = (error: unknown) => {
      if (!disposed) reportError(error);
    };
    void subscribe("workspace.state", "*", (event) => {
      rememberState(event.state);
      const facts = workspaceFacts(event.workspace, { [event.workspace]: event.state });
      if (facts.kind !== "ssh") return;
      if (event.transition === "trusted") {
        const workspace = t("sshWorkspaceName", "{folder} @{host}")
          .replace("{folder}", facts.folderName)
          .replace("{host}", facts.hostLabel);
        addNotice({
          type: "success",
          message: t("sshNoticeTrusted", "Trusted {workspace}. {count} remote skills enabled")
            .replace("{workspace}", workspace)
            .replace("{count}", String(event.state.remoteSkillCount)),
          action: {
            label: t("sshNoticeUndo", "Undo"),
            onClick: () => void setTrust(facts.key, "read-only").catch(reportError),
          },
        });
      }
      if (event.transition === "reconnected-clean") {
        addNotice({
          type: "success",
          message: t(
            "sshNoticeReconnectedClean",
            "Reconnected to {host}. Remote processes from before the disconnect were confirmed clean",
          ).replace("{host}", facts.hostLabel),
        });
      }
    }).then(keepSubscription, reportLoadError);
    void subscribe("workspace.trustPrompt", "*", (event) => {
      setTrustPrompts((current) => updateRemoteTrustPrompts(current, event));
    }).then(keepSubscription, reportLoadError);
    void call("remote.workspacesSnapshot", undefined).then(({ states }) => {
      if (disposed) return;
      const snapshot = Object.fromEntries(
        Object.entries(states).map(([key, state]) => [describeWorkspaceKey(key).workspaceKey, state]),
      );
      setStatesByWorkspace((current) => ({ ...snapshot, ...current }));
    }, reportLoadError);
    return () => {
      disposed = true;
      for (const off of subscriptions) off();
    };
  }, [addNotice, rememberState, reportError, setTrust, t]);

  const dismissNotice = useCallback((id: string) => dispatchNotice({ type: "mark_exiting", id }), []);

  return {
    statesByWorkspace,
    activeTrustPrompt,
    trustPrompts,
    setTrust,
    syncRules,
    reconnect,
    disconnect,
    cleanupRetry,
    resolveTrustPrompt,
    listHosts,
    browseRemote,
    acceptHostKey,
    installPython,
    notices: noticeState.visible,
    dismissNotice,
    reportError,
  };
}

export type RemoteWorkspaces = ReturnType<typeof useRemoteWorkspaces>;

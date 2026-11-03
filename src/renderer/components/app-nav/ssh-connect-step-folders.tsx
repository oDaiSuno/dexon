import { useEffect, useRef, type Dispatch } from "react";
import { useI18n } from "@/i18n";
import { formatSshHostLabel } from "@shared/workspace-ref";
import type { SshConnectEvent, SshConnectServices, SshConnectState } from "./ssh-connect-state";
import { SshConnectButton, SshConnectNote } from "./ssh-connect-parts";
import { SshConnectDirectory } from "./ssh-connect-directory";
import { SshConnectHelp } from "./ssh-connect-help";

export function SshConnectStepFolders({
  state,
  dispatch,
  services,
  onOpenFolder,
}: {
  state: Extract<SshConnectState, { step: "browse" }>;
  dispatch: Dispatch<SshConnectEvent>;
  services?: SshConnectServices;
  onOpenFolder: (folder: string) => void;
}) {
  const { t } = useI18n();
  const { request, content } = state;
  const stepRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (content.status !== "ready") stepRef.current?.focus();
  }, [content.status]);
  const browseRemote = services?.browseRemote;
  const acceptHostKey = services?.acceptHostKey;
  const installPython = services?.installPython;
  useEffect(() => {
    if (!browseRemote) return;
    let current = true;
    const run = async () => {
      if (request.operation.kind === "accept" && acceptHostKey)
        await acceptHostKey(request.target, request.operation.fingerprint);
      if (request.operation.kind === "install" && installPython) await installPython(request.target);
      return browseRemote(request.target, request.path);
    };
    void run().then(
      (result) => {
        if (current) dispatch({ type: "browsed", request, result });
      },
      (error: unknown) => {
        if (current)
          dispatch({
            type: "browsed",
            request,
            result: {
              status: "error",
              target: request.target,
              message: error instanceof Error ? error.message : String(error),
            },
          });
      },
    );
    return () => {
      current = false;
    };
  }, [request, browseRemote, acceptHostKey, installPython, dispatch]);
  return (
    <div ref={stepRef} tabIndex={-1} style={{ padding: 10, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
        {t("sshConnectStepFolders", "Step 2 of 2: choose a project folder on {host}").replace(
          "{host}",
          formatSshHostLabel(request.target),
        )}
      </h2>
      <SshConnectButton onClick={() => dispatch({ type: "servers" })}>
        {t("sshConnectChangeServer", "Change server")}
      </SshConnectButton>
      {content.status === "loading" && (
        <SshConnectNote>{t("sshConnectLoadingFolders", "Connecting and loading folders…")}</SshConnectNote>
      )}
      {content.status === "ready" && (
        <SshConnectDirectory
          result={content}
          filter={state.filter}
          selectedPath={state.selectedPath}
          dispatch={dispatch}
          onOpenFolder={onOpenFolder}
        />
      )}
      {content.status !== "ready" && content.status !== "loading" && (
        <SshConnectHelp result={content} dispatch={dispatch} />
      )}
    </div>
  );
}

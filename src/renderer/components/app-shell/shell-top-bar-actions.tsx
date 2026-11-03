import { RightPanelToggle, type useRightPanelToggleFocus } from "./right-panel-toggle";
import { SshConnectionPill } from "./ssh-connection-pill";

export function ShellTopBarActions({
  workspace,
  dismissed,
  rightPanelOpen,
  panelToggle,
}: {
  workspace: string | null;
  dismissed: boolean;
  rightPanelOpen: boolean;
  panelToggle: ReturnType<typeof useRightPanelToggleFocus>;
}) {
  return (
    <>
      <SshConnectionPill key={workspace} workspace={workspace} dismissed={dismissed} />
      {!rightPanelOpen && (
        <RightPanelToggle
          placement="top-bar"
          onToggle={() => panelToggle.toggleFrom("top-bar")}
          focusRequested={panelToggle.focusTarget === "top-bar"}
          onFocusHandled={panelToggle.clearFocusTarget}
        />
      )}
    </>
  );
}

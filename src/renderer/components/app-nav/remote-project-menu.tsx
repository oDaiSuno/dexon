import { useI18n } from "@/i18n";
import type { WorkspaceTrustMode } from "@contract/workspace";
import { CloseIcon, RefreshCwIcon } from "../chat-input/icons";
import { LockKeyholeGlyph } from "../chat-input/workspace-glyphs";
import { CopyGlyph } from "../processes/process-icons";
import { NewSessionIcon } from "./nav-icons";
import { ProjectMenuItem } from "./project-menu";

export interface RemoteProjectMenuProps {
  trust: WorkspaceTrustMode;
  onNewSession: () => void;
  onCopyAddress: () => void;
  onSyncRules: () => void;
  onToggleTrust: () => void;
  onDisconnect: () => void;
}

export function RemoteProjectMenuContent({
  remote,
  onChoose,
}: {
  remote: RemoteProjectMenuProps;
  onChoose: (action: () => void) => void;
}) {
  const { t } = useI18n();
  const items = [
    {
      label: t("sshSidebarNewSession", "New session in this remote folder"),
      icon: <NewSessionIcon size={15} />,
      run: remote.onNewSession,
    },
    {
      label: t("sshSidebarCopyAddress", "Copy full SSH address"),
      icon: <CopyGlyph size={15} />,
      run: remote.onCopyAddress,
    },
    {
      label: t("sshSidebarSyncRules", "Re-sync remote AGENTS.md and skills"),
      icon: <RefreshCwIcon size={15} />,
      run: remote.onSyncRules,
    },
    {
      label:
        remote.trust === "trusted"
          ? t("sshSidebarReadOnly", "Switch to safe read-only browsing")
          : t("sshSidebarTrust", "Trust this remote repository"),
      icon: <LockKeyholeGlyph size={15} />,
      run: remote.onToggleTrust,
    },
    {
      label: t("sshSidebarDisconnect", "Disconnect and close this remote project (keep local history)"),
      icon: <CloseIcon size={15} />,
      run: remote.onDisconnect,
    },
  ];
  return items.map((item) => (
    <ProjectMenuItem
      key={item.label}
      label={item.label}
      icon={item.icon}
      disabled={false}
      wrapLabel
      onChoose={() => onChoose(item.run)}
    />
  ));
}

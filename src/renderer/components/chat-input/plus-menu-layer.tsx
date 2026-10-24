import { useI18n } from "@/i18n";
import { QuickChannelBinding } from "../channels/QuickChannelBinding";
import { RemoteBrands, RemoteGlyph, RemoteMenuStatus } from "../channels/quick-channel-rows";
import { accountPresence } from "../channels/channels-config/channel-presentation";
import { statusFor } from "../channels/channels-config/channel-labels";
import { PlusMenu, type PlusMenuRow } from "./PlusMenu";
import { PackageIcon, PaperclipIcon } from "./icons";
import type { ComposerNavigation, ComposerRemote } from "./types";

export interface PlusMenuLayerProps {
  plusMenuOpen: boolean;
  remotePanelOpen: boolean;
  skillCount: number;
  remote?: ComposerRemote | null;
  navigation?: ComposerNavigation;
  onOpenPicker: () => void;
  onOpenSkillPicker: () => void;
  onOpenRemotePanel: () => void;
  onBackToPlusMenu: () => void;
  onCloseMenus: () => void;
}

export function PlusMenuLayer({
  plusMenuOpen,
  remotePanelOpen,
  skillCount,
  remote,
  navigation,
  onOpenPicker,
  onOpenSkillPicker,
  onOpenRemotePanel,
  onBackToPlusMenu,
  onCloseMenus,
}: PlusMenuLayerProps) {
  const { t } = useI18n();
  const openRemotePage = () => {
    onCloseMenus();
    navigation?.openRemote();
  };

  if (remotePanelOpen && remote) {
    return (
      <QuickChannelBinding
        sessionId={remote.sessionId}
        snapshot={remote.snapshot}
        onSnapshotChange={remote.onSnapshotChange}
        onBack={onBackToPlusMenu}
        onManage={openRemotePage}
      />
    );
  }
  if (!plusMenuOpen) return null;

  const rows: PlusMenuRow[] = [
    {
      key: "files",
      name: t("plusAttachFiles", "Add files"),
      desc: t("plusAttachFilesDesc", "Pick files or images from your computer, or paste a screenshot"),
      icon: <PaperclipIcon size={16} />,
      onSelect: onOpenPicker,
    },
    {
      key: "skill",
      name: t("plusUseSkill", "Use a skill"),
      desc: t("plusUseSkillDesc", "Search and invoke installed skills"),
      icon: <PackageIcon size={16} />,
      count: skillCount > 0 ? String(skillCount) : undefined,
      submenu: true,
      onSelect: onOpenSkillPicker,
    },
  ];
  if (remote) {
    const linked = remote.snapshot.bindings.filter((binding) => binding.sessionId === remote.sessionId);
    const first = linked[0];
    const account = first ? remote.snapshot.accounts.find((candidate) => candidate.id === first.accountId) : undefined;
    const online = first ? accountPresence(statusFor(remote.snapshot, first.accountId), t).online : false;
    rows.push({
      key: "remote",
      name: t("channels", "Remote chat"),
      desc: <RemoteMenuStatus linked={linked} account={account} online={online} />,
      icon: <RemoteGlyph name="smartphone" size={16} />,
      trailing: linked.length === 0 ? <RemoteBrands size={16} gap={3} /> : undefined,
      submenu: true,
      onSelect: onOpenRemotePanel,
    });
  }
  return <PlusMenu rows={rows} defaultKey="skill" />;
}

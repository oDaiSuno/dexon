import { useState } from "react";
import type { PluginPackageInfo } from "@/lib/api-types";
import type { ChannelsSnapshot } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { CapabilityRequired } from "../CapabilityRequired";
import { Button } from "../form-controls";
import type { PluginLibrary } from "../plugins/use-plugin-library";
import type { SkillDirectory } from "../skills/use-skill-directory";
import { AttentionCard } from "./attention-card";
import { OverviewHero } from "./overview-hero";
import {
  capabilitySummary,
  missingPackages,
  packageResources,
  pendingReloadPackages,
  type PackageResource,
} from "./overview-model";
import { PlusIcon, RefreshCwIcon } from "./overview-icons";
import { RemoteEntryCard } from "./remote-entry-card";
import { ExtensionsSection, PromptsSection, SourcesBar } from "./resource-sections";
import { SkillDrawer } from "./skill-drawer";
import { SkillGrid } from "./skill-grid";

export function ResourcesOverview({
  cwd,
  library,
  directory,
  canReload,
  channelSnapshot,
  onOpenRemote,
  onAdd,
  onRefresh,
  onDiscoverSkills,
  onOpenPackage,
  onManageSources,
}: {
  cwd: string;
  library: PluginLibrary;
  directory: SkillDirectory;
  canReload: boolean;
  channelSnapshot: ChannelsSnapshot;
  onOpenRemote: () => void;
  onAdd: () => void;
  onRefresh: () => void;
  onDiscoverSkills: () => void;
  onOpenPackage: (pkg: PluginPackageInfo) => void;
  onManageSources: () => void;
}) {
  const { t } = useI18n();
  const packages = library.packages;
  const extensions = packageResources(packages, "extension");
  const prompts = packageResources(packages, "prompt");
  const summary = capabilitySummary(directory.skills, packages, extensions.length, prompts.length);
  const openResource = (resource: PackageResource) => onOpenPackage(resource.pkg);
  const [attentionTried, setAttentionTried] = useState(false);
  const attentionError = attentionTried && library.busyKey === null ? library.actionError : null;
  const [openSkillPath, setOpenSkillPath] = useState<string | null>(null);
  const openSkill = directory.skills.find((skill) => skill.filePath === openSkillPath) ?? null;
  const reinstall = (pkg: PluginPackageInfo) => {
    setAttentionTried(true);
    void library.installPluginSource(pkg.source, pkg.scope);
  };
  const reload = () => {
    setAttentionTried(true);
    void library.reloadSession();
  };

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col items-stretch gap-[36px]">
      <header className="flex w-full items-end gap-[16px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
          <div className="flex items-center gap-[8px]">
            <h1 className="type-title-page m-0 text-[var(--fx-text-primary)]">
              {t("navPluginsSkills", "Plugins & Skills")}
            </h1>
            <Button
              variant="ghost"
              aria-label={t("refresh", "Refresh")}
              title={t("refresh", "Refresh")}
              disabled={library.loading || directory.loading}
              onClick={onRefresh}
              className="h-[28px] w-[28px] px-0"
            >
              <RefreshCwIcon size={16} />
            </Button>
          </div>
          <p className="type-body-large m-0 text-[var(--fx-text-secondary)]">
            {t("resourcesSubtitle", "Skills, tool extensions and prompt templates the Agent can use.")}
          </p>
        </div>
        <Button variant="primary" onClick={onAdd}>
          <PlusIcon size={14} />
          {t("resourcesAdd", "Add")}
        </Button>
      </header>
      <OverviewHero summary={summary} />
      <AttentionCard
        updated={pendingReloadPackages(packages)}
        missing={missingPackages(packages)}
        busyKey={library.busyKey}
        error={attentionError}
        canReload={canReload}
        onReinstall={reinstall}
        onReload={reload}
      >
        {attentionTried && library.capabilityIssue && library.hasPendingCapabilityOperation && (
          <CapabilityRequired
            issue={library.capabilityIssue}
            cwd={cwd}
            onContinue={library.retryCapabilityOperation}
            onCancel={library.clearCapabilityPending}
          />
        )}
      </AttentionCard>
      <RemoteEntryCard snapshot={channelSnapshot} onOpen={onOpenRemote} />
      <SkillGrid
        skills={directory.skills}
        loading={directory.loading}
        error={directory.error}
        toggling={directory.toggling}
        saveError={directory.saveError}
        onOpenSkill={(skill) => setOpenSkillPath(skill.filePath)}
        onToggle={(skill) => void directory.toggle(skill)}
        onDiscover={onDiscoverSkills}
      />
      <ExtensionsSection extensions={extensions} onOpen={openResource} />
      <PromptsSection prompts={prompts} onOpen={openResource} />
      <SourcesBar packageCount={packages.length} onOpen={onManageSources} />
      {openSkill && (
        <SkillDrawer
          skill={openSkill}
          cwd={cwd}
          toggling={directory.toggling.has(openSkill.filePath)}
          saveError={directory.saveError}
          onToggle={(skill) => void directory.toggle(skill)}
          onClose={() => setOpenSkillPath(null)}
        />
      )}
    </div>
  );
}

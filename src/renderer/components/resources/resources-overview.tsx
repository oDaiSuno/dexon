import { useState } from "react";
import type { PluginPackageInfo } from "@/lib/api-types";
import type { ChannelsSnapshot } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { CapabilityRequired } from "../CapabilityRequired";
import { Button } from "../form-controls";
import type { PluginLibrary } from "../plugins/use-plugin-library";
import type { SkillDirectory } from "../skills/use-skill-directory";
import type { Skill } from "../skills/skill-shared";
import { AttentionCard } from "./attention-card";
import { OverviewHero } from "./overview-hero";
import { capabilitySummary, missingPackages, packageResources, type PackageResource } from "./overview-model";
import { PlusIcon } from "./overview-icons";
import { RemoteEntryCard } from "./remote-entry-card";
import { ExtensionsSection, PromptsSection, SourcesBar } from "./resource-sections";
import { SkillGrid } from "./skill-grid";

export function ResourcesOverview({
  cwd,
  library,
  directory,
  channelSnapshot,
  onOpenRemote,
  onAdd,
  onOpenSkill,
  onDiscoverSkills,
  onOpenPackage,
  onManageSources,
}: {
  cwd: string;
  library: PluginLibrary;
  directory: SkillDirectory;
  channelSnapshot: ChannelsSnapshot;
  onOpenRemote: () => void;
  onAdd: () => void;
  onOpenSkill: (skill: Skill) => void;
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
  const [reinstallTried, setReinstallTried] = useState(false);
  const reinstallError = reinstallTried && library.busyKey === null ? library.actionError : null;
  const reinstall = (pkg: PluginPackageInfo) => {
    setReinstallTried(true);
    void library.installPluginSource(pkg.source, pkg.scope);
  };

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col items-stretch gap-[36px]">
      <header className="flex w-full items-end gap-[16px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
          <h1 className="type-title-page m-0 text-[var(--fx-text-primary)]">
            {t("navPluginsSkills", "Plugins & Skills")}
          </h1>
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
        packages={missingPackages(packages)}
        busyKey={library.busyKey}
        error={reinstallError}
        onReinstall={reinstall}
      >
        {reinstallTried && library.capabilityIssue && library.hasPendingCapabilityOperation && (
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
        packages={packages}
        loading={directory.loading}
        error={directory.error}
        toggling={directory.toggling}
        saveError={directory.saveError}
        onOpenSkill={onOpenSkill}
        onToggle={(skill) => void directory.toggle(skill)}
        onDiscover={onDiscoverSkills}
      />
      <ExtensionsSection extensions={extensions} onOpen={openResource} />
      <PromptsSection prompts={prompts} onOpen={openResource} />
      <SourcesBar packageCount={packages.length} onOpen={onManageSources} />
    </div>
  );
}

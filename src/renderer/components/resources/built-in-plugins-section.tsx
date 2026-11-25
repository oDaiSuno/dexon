import type { EnvironmentId } from "@contract/environment";
import type { ChannelsSnapshot } from "@shared/channel-types";
import { useState } from "react";
import { useI18n } from "@/i18n";
import { useEnvironments } from "@/lib/environment-registry";
import { useCodemodeSettings } from "@/lib/codemode-settings";
import { CodeModeCard } from "./code-mode-card";
import { CodeModeDrawer } from "./code-mode-drawer";
import { CodeModeError } from "./code-mode-shared";
import { RemoteEntryCard } from "./remote-entry-card";
import { SectionHeader } from "./resource-sections";

export function BuiltInPluginsSection({
  environmentId,
  cwd,
  snapshot,
  onOpenRemote,
  onOpenFile,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  snapshot: ChannelsSnapshot;
  onOpenRemote: () => void;
  onOpenFile?: (filePath: string, environmentId: EnvironmentId) => void;
}) {
  const { t } = useI18n();
  const controller = useCodemodeSettings(environmentId, cwd);
  const environments = useEnvironments();
  const environmentLabel = environments.find((environment) => environment.id === environmentId)?.label ?? environmentId;
  const scopeKey = JSON.stringify([environmentId, cwd]);
  const [drawer, setDrawer] = useState({ scopeKey, open: false });
  if (drawer.scopeKey !== scopeKey) setDrawer({ scopeKey, open: false });
  const drawerOpen = drawer.scopeKey === scopeKey && drawer.open;
  const close = () => setDrawer({ scopeKey, open: false });
  return (
    <section aria-labelledby="resource-builtin-heading" className="flex w-full flex-col gap-[12px]">
      <SectionHeader id="resource-builtin-heading" title={t("builtInPlugins", "Built-in plugins")} count={2} />
      <div className="flex flex-col gap-2.5">
        <RemoteEntryCard snapshot={snapshot} onOpen={onOpenRemote} />
        <CodeModeCard
          environmentId={environmentId}
          controller={controller}
          onOpen={() => setDrawer({ scopeKey, open: true })}
        />
      </div>
      {!drawerOpen && <CodeModeError controller={controller} />}
      {drawerOpen && (
        <CodeModeDrawer
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          controller={controller}
          onClose={close}
          onOpenFile={
            onOpenFile
              ? (filePath, sourceEnvironmentId) => {
                  close();
                  onOpenFile(filePath, sourceEnvironmentId);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

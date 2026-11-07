import { useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import { useI18n } from "@/i18n";
import { copyText } from "@/lib/clipboard";
import { environmentAffordances } from "@/lib/environment-affordances";
import { useEnvironments } from "@/lib/environment-registry";
import { DisabledReason, useRevealInFileManagerLabel } from "../disabled-reason";

export function RemoteWorkspaceActions({ environmentId, path }: { environmentId: EnvironmentId; path: string }) {
  const { t } = useI18n();
  const [error, setError] = useState(false);
  const { isPrimary, unavailable } = environmentAffordances(
    useEnvironments().find((view) => view.id === environmentId),
  );
  const revealLabel = useRevealInFileManagerLabel(!isPrimary);
  if (isPrimary) return null;
  return (
    <div className="remote-workspace-actions">
      <DisabledReason reason={unavailable.revealInFileManager}>
        <button type="button" className="remote-workspace-action type-meta-default">
          {revealLabel}
        </button>
      </DisabledReason>
      <button
        type="button"
        className="remote-workspace-action type-meta-default"
        onClick={() => {
          setError(false);
          void copyText(path).catch(() => setError(true));
        }}
      >
        {t("remoteCopyPath", "Copy remote path")}
      </button>
      {error && (
        <span role="alert" className="type-meta-default">
          {t("copyFailed", "Copy failed")}
        </span>
      )}
    </div>
  );
}

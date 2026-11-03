import { useCallback, useState } from "react";
import { describeWorkspaceKey } from "@shared/workspace-ref";

export function useWorkspaceBannerDismissal(folder: string | null) {
  const key = describeWorkspaceKey(folder ?? "").workspaceKey;
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const dismiss = useCallback(() => setDismissed((current) => new Set(current).add(key)), [key]);
  return { dismissed: dismissed.has(key), dismiss };
}

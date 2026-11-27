import type { EnvironmentId } from "@contract/environment";

export interface FileViewerProps {
  environmentId: EnvironmentId;
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string, environmentId?: EnvironmentId) => void;
}

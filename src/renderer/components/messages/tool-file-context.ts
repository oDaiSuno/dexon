import { createContext, useContext } from "react";

interface ToolFileNavigation {
  cwd?: string;
  homeDir?: string;
  onOpenFile?: (filePath: string) => void;
}

const ToolFileContext = createContext<ToolFileNavigation>({});

export const ToolFileProvider = ToolFileContext.Provider;

export function useToolFileNavigation() {
  return useContext(ToolFileContext);
}

import { PRIMARY_ENVIRONMENT_ID, type EnvironmentView } from "@contract/environment";

export interface EnvironmentAffordances {
  isPrimary: boolean;
  pickDirectory: "native" | "typed-path";
  revealInFileManager: boolean;
  openLocalFile: boolean;
  attachLocalFiles: boolean;
  embeddedBrowser: boolean;
  pathStyle: "posix" | "win32";
  platformOs: "linux" | "darwin" | "win32";
}

export function environmentAffordances(view: EnvironmentView | null | undefined): EnvironmentAffordances {
  const isPrimary = !view || view.id === PRIMARY_ENVIRONMENT_ID;
  const localPlatform = typeof window === "undefined" ? undefined : window.piBridge?.platform;
  const platformOs = view?.descriptor?.platform.os ?? (isPrimary ? localPlatform : "linux");
  const os = platformOs === "win32" ? "win32" : platformOs === "darwin" ? "darwin" : "linux";
  const capabilities = view?.descriptor?.capabilities;
  return {
    isPrimary,
    pickDirectory: isPrimary && capabilities?.nativeDialogs !== false ? "native" : "typed-path",
    revealInFileManager: isPrimary && capabilities?.revealInFileManager !== false,
    openLocalFile: isPrimary,
    attachLocalFiles: isPrimary,
    embeddedBrowser: isPrimary && capabilities?.browser !== false,
    pathStyle: view?.descriptor?.platform.pathStyle ?? (os === "win32" ? "win32" : "posix"),
    platformOs: os,
  };
}

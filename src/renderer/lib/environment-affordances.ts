import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId, type EnvironmentView } from "@contract/environment";

export type UnavailableFeature = "embeddedBrowser" | "revealInFileManager";
export type UnavailableReason = {
  kind: "remote-environment" | "capability-missing" | "environment-unknown";
  environmentId: EnvironmentId | null;
  label: string;
  feature: UnavailableFeature;
};

export interface EnvironmentAffordances {
  isPrimary: boolean;
  pickDirectory: "native" | "typed-path";
  revealInFileManager: boolean;
  openLocalFile: boolean;
  attachLocalFiles: boolean;
  embeddedBrowser: boolean;
  pathStyle: "posix" | "win32";
  platformOs: "linux" | "darwin" | "win32";
  unavailable: Partial<Record<UnavailableFeature, UnavailableReason>>;
}

export function environmentAffordances(view: EnvironmentView | null | undefined): EnvironmentAffordances {
  const isPrimary = view?.id === PRIMARY_ENVIRONMENT_ID;
  const localPlatform = typeof window === "undefined" ? undefined : window.piBridge?.platform;
  const platformOs = view?.descriptor?.platform.os ?? (isPrimary ? localPlatform : "linux");
  const os = platformOs === "win32" ? "win32" : platformOs === "darwin" ? "darwin" : "linux";
  const capabilities = view?.descriptor?.capabilities;
  const revealInFileManager = isPrimary && capabilities?.revealInFileManager !== false;
  const embeddedBrowser = isPrimary && capabilities?.browser !== false;
  const reason = (feature: UnavailableFeature): UnavailableReason => ({
    kind: !view ? "environment-unknown" : isPrimary ? "capability-missing" : "remote-environment",
    environmentId: view?.id ?? null,
    label: view?.label ?? "",
    feature,
  });
  return {
    isPrimary,
    pickDirectory: isPrimary && capabilities?.nativeDialogs !== false ? "native" : "typed-path",
    revealInFileManager,
    openLocalFile: isPrimary,
    attachLocalFiles: isPrimary,
    embeddedBrowser,
    pathStyle: view?.descriptor?.platform.pathStyle ?? (os === "win32" ? "win32" : "posix"),
    platformOs: os,
    unavailable: {
      ...(!revealInFileManager ? { revealInFileManager: reason("revealInFileManager") } : {}),
      ...(!embeddedBrowser ? { embeddedBrowser: reason("embeddedBrowser") } : {}),
    },
  };
}

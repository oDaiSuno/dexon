export * from "@shared/types";

import type { SessionInfo as HostSessionInfo } from "@shared/types";
import type { EnvironmentId } from "@contract/environment";

export type SessionInfo = HostSessionInfo & { environmentId?: EnvironmentId };

import type { AutomationChange } from "../shared/automation/views";
import type { AgentEvent, LoginProgressEvent, RunningStateEvent, SessionInfo } from "./types";
import type {
  ChannelBindingChange,
  ChannelStatus,
  ChannelLoginEvent,
  ChannelPairingRequest,
  ChannelActivity,
} from "../shared/channel-types";
import type { ManagedProcessChangedEvent, ManagedProcessOutputEvent } from "./processes";

export interface Streams {
  "automation.changed": AutomationChange;
  "agent.events": AgentEvent;
  "agent.running": RunningStateEvent;
  "auth.login": LoginProgressEvent;
  "sessions.changed": {
    cwd: string | null;
    sessionId?: string;
    session?: SessionInfo;
    deleted?: boolean;
    fullRefresh?: boolean;
    cause?: "live-append" | "mutation" | "external";
  };
  "files.changed": {
    path: string;
    event: "connected" | "change" | "error";
    mtime?: string;
    size?: number;
    message?: string;
  };
  "channels.status": ChannelStatus;
  "channels.login": ChannelLoginEvent;
  "channels.pairing": ChannelPairingRequest;
  "channels.binding": ChannelBindingChange;
  "channels.activity": ChannelActivity;
  "processes.changed": ManagedProcessChangedEvent;
  "processes.output": ManagedProcessOutputEvent;
}

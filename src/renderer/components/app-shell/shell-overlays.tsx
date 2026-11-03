import { BrowserAuthorizationDialog } from "../browser/BrowserAuthorizationDialog";
import { NoticeShelf } from "../chat-window/status";
import { getSessionDisplayTitle } from "@/lib/session-list";
import type { SessionInfo } from "@/lib/types";
import type { NoticeItem } from "@/lib/notice-queue";
import type { useBrowserAuthorization } from "./use-browser-authorization";

export function ShellOverlays({
  notices,
  onDismissNotice,
  authorization,
  selectedSession,
  hidden,
  onManage,
}: {
  notices: NoticeItem[];
  onDismissNotice: (id: string) => void;
  authorization: ReturnType<typeof useBrowserAuthorization>;
  selectedSession: SessionInfo | null;
  hidden: boolean;
  onManage: (sessionId: string) => void;
}) {
  return (
    <>
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 1100 }}>
        <NoticeShelf notices={notices} onDismiss={onDismissNotice} floating align="right" />
      </div>
      {(() => {
        const authorizationRequest = authorization.browserAuthorization;
        if (!authorizationRequest || hidden) return null;
        return (
          <BrowserAuthorizationDialog
            request={authorizationRequest}
            sessionTitle={
              selectedSession?.id === authorizationRequest.sessionId
                ? getSessionDisplayTitle(selectedSession, 240)
                : authorizationRequest.sessionId
            }
            onRespond={authorization.respondToBrowserAuthorization}
            onManage={() => {
              onManage(authorizationRequest.sessionId);
            }}
          />
        );
      })()}
    </>
  );
}

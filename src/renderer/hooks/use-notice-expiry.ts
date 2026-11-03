import { useEffect, type Dispatch } from "react";
import { NOTICE_EXIT_ANIMATION_MS, noticeExpiryDelay, type NoticeAction, type NoticeItem } from "@/lib/notice-queue";

export function useNoticeExpiry(notices: readonly NoticeItem[], dispatch: Dispatch<NoticeAction>) {
  useEffect(() => {
    const exiting = notices.find((notice) => notice.exiting);
    if (exiting) {
      const timer = setTimeout(() => {
        dispatch({ type: "remove", id: exiting.id, now: Date.now() });
      }, NOTICE_EXIT_ANIMATION_MS);
      return () => clearTimeout(timer);
    }
    const next = notices.reduce<NoticeItem | undefined>(
      (earliest, notice) => (!earliest || notice.expiresAt < earliest.expiresAt ? notice : earliest),
      undefined,
    );
    if (!next) return;
    const timer = setTimeout(
      () => dispatch({ type: "mark_exiting", id: next.id }),
      noticeExpiryDelay(next, Date.now()),
    );
    return () => clearTimeout(timer);
  }, [dispatch, notices]);
}

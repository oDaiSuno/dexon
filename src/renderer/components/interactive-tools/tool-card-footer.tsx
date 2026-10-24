import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { CardStatus } from "@/lib/interactive-tool-store";
import { CircleAlertIcon, LoaderCircleIcon } from "./tool-card-icons";

export type FooterSlot = (meta: ReactNode, actions: ReactNode) => ReactNode;

export function FailureBar() {
  const { t } = useI18n();
  return (
    <div className="tool-error-bar">
      <span className="tool-error-icon" aria-hidden="true">
        <CircleAlertIcon size={14} />
      </span>
      <span className="tool-error-text type-label-default">
        {t(
          "toolSendFailedDetail",
          "Your answers weren't delivered. Everything you picked is still here, so you can try again.",
        )}
      </span>
    </div>
  );
}

export function CardFooter({
  status,
  meta,
  onAbandon,
  children,
}: {
  status: CardStatus;
  meta?: ReactNode;
  onAbandon?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const sending = status === "sending";
  return (
    <footer className="tool-card-footer">
      {onAbandon && (
        <button type="button" className="tool-abandon type-label-default" disabled={sending} onClick={onAbandon}>
          {t("toolAbandon", "Abandon answer")}
        </button>
      )}
      <span className="tool-spacer" />
      {sending ? (
        <span className="tool-sending">
          <span className="tool-sending-icon" aria-hidden="true">
            <LoaderCircleIcon size={13} />
          </span>
          <span className="type-label-default">{t("toolSending", "Sending")}</span>
        </span>
      ) : meta ? (
        <span className="tool-footer-meta type-mono-meta">{meta}</span>
      ) : null}
      <div className="tool-footer-actions">{children}</div>
    </footer>
  );
}

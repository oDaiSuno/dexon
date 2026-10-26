import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { useI18n } from "@/i18n";
import type { CardStatus } from "@/lib/interactive-tool-store";
import {
  ArrowUpRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  CloseIcon,
  MessageQuestionIcon,
  MinusIcon,
  TimerOffIcon,
} from "./tool-card-icons";

type Translate = (key: string, fallback: string) => string;

export function statusLabel(t: Translate, status: CardStatus): string {
  if (status === "submitted") return t("toolSubmitted", "Answers sent");
  if (status === "cancelled") return t("toolAbandoned", "Answering abandoned");
  if (status === "completed") return t("toolCompleted", "Interaction ended");
  if (status === "expired") return t("toolExpired", "This question has expired");
  if (status === "sending") return t("toolSending", "Sending");
  if (status === "checking") return t("toolChecking", "Checking whether this request is still active…");
  if (status === "failed") return t("toolSendFailed", "Not delivered");
  return t("toolWaiting", "Waiting for your answer");
}

function StatusIcon({ status }: { status: CardStatus }) {
  const icon =
    status === "failed" ? (
      <CircleAlertIcon size={15} />
    ) : status === "submitted" || status === "completed" ? (
      <CircleCheckIcon size={15} />
    ) : status === "expired" ? (
      <TimerOffIcon size={15} />
    ) : status === "cancelled" ? (
      <CircleXIcon size={15} />
    ) : (
      <MessageQuestionIcon size={15} />
    );
  return <span className="tool-status-icon">{icon}</span>;
}

export function StatusLead({
  status,
  live = true,
  children,
}: {
  status: CardStatus;
  live?: boolean;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <>
      <StatusIcon status={status} />
      <span className="tool-card-status type-label-medium" role={live ? "status" : undefined}>
        {statusLabel(t, status)}
      </span>
      {children ? (
        <>
          <span className="tool-dot" aria-hidden="true" />
          {children}
        </>
      ) : null}
    </>
  );
}

export function IconButton({
  label,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-label"> & { label: string }) {
  return (
    <button type="button" className="tool-icon-button" aria-label={label} {...props}>
      {children}
    </button>
  );
}

export function CardHeader({
  lead,
  nav,
  collapseDisabled,
  onCollapse,
}: {
  lead: ReactNode;
  nav?: ReactNode;
  collapseDisabled?: boolean;
  onCollapse: () => void;
}) {
  const { t } = useI18n();
  return (
    <header className="tool-card-header">
      {lead}
      <span className="tool-spacer" />
      {nav}
      {nav ? <span className="tool-divider" aria-hidden="true" /> : null}
      <IconButton
        label={t("toolCollapse", "Collapse — your answers stay")}
        disabled={collapseDisabled}
        onClick={onCollapse}
      >
        <MinusIcon size={14} />
      </IconButton>
    </header>
  );
}

export function ResumeRow({
  ref,
  status,
  title,
  onResume,
}: {
  ref: Ref<HTMLButtonElement>;
  status: CardStatus;
  title: string;
  onResume: () => void;
}) {
  const { t } = useI18n();
  return (
    <button ref={ref} type="button" className="tool-resume" onClick={onResume}>
      <StatusLead status={status} live={false}>
        <span className="tool-line-detail type-body-default">{title}</span>
      </StatusLead>
      <span className="tool-resume-link type-label-medium">{t("toolResume", "Continue answering")}</span>
      <span className="tool-resume-arrow">
        <ArrowUpRightIcon size={13} />
      </span>
    </button>
  );
}

export function Receipt({ status, detail, onDismiss }: { status: CardStatus; detail: string; onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <div className="tool-receipt">
      <StatusLead status={status}>
        {detail ? <span className="tool-line-detail type-body-default">{detail}</span> : null}
      </StatusLead>
      {detail ? null : <span className="tool-spacer" />}
      <IconButton label={t("toolDismiss", "Dismiss this status")} onClick={onDismiss}>
        <CloseIcon size={14} />
      </IconButton>
    </div>
  );
}

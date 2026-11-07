import {
  cloneElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import type { UnavailableReason } from "@/lib/environment-affordances";

export function useRevealInFileManagerLabel(remote: boolean): string {
  const { t } = useI18n();
  const platform = window.piBridge?.platform;
  if (remote) {
    if (platform === "win32") return t("remoteShowInExplorer", "Show in File Explorer");
    if (platform === "linux") return t("remoteShowInFileManager", "Show in File Manager");
    return t("remoteShowInFinder", "Show in Finder");
  }
  if (platform === "win32") return t("openInExplorer", "Open in File Explorer");
  if (platform === "linux") return t("openInFileManager", "Open in File Manager");
  return t("openInFinder", "Open in Finder");
}

export function DisabledReason({
  reason,
  children,
}: {
  reason?: UnavailableReason | null;
  children: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
}) {
  const { t } = useI18n();
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 0 });
  const open = Boolean(reason) && (hovered || focused) && !dismissed;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const width = tooltip.current?.offsetWidth ?? 320;
      const height = tooltip.current?.offsetHeight ?? 80;
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: Math.max(8, rect.bottom + height + 14 > window.innerHeight ? rect.top - height - 6 : rect.bottom + 6),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  if (!reason) return children;
  const message =
    reason.kind === "environment-unknown"
      ? t("remoteFeatureEnvironmentUnknown", "Server information is not available yet.")
      : reason.kind === "capability-missing"
        ? t("remoteFeatureCapabilityMissing", "This environment does not support this action.")
        : reason.feature === "embeddedBrowser"
          ? t("remoteLocalPreviewUnavailable", "Remote project spaces do not support embedded local preview.")
          : t("remoteRevealUnavailable", "Remote project spaces cannot be opened in the local file manager.");
  const detail =
    reason.kind === "remote-environment" && reason.feature === "revealInFileManager"
      ? t(
          "remoteRevealAlternative",
          "Files are stored on {server}. Copy the remote path or view them in the file panel.",
        ).replace("{server}", reason.label)
      : null;

  return (
    <span
      ref={root}
      className="remote-disabled-reason"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        setFocused(true);
        setDismissed(false);
      }}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setDismissed(true);
      }}
      onClickCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {cloneElement(children, {
        disabled: false,
        "aria-disabled": true,
        "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
        className: `${children.props.className ?? ""} remote-disabled-trigger`,
        onClick: undefined,
      })}
      {createPortal(
        <span
          id={id}
          ref={tooltip}
          role="tooltip"
          hidden={!open}
          className="remote-disabled-tooltip type-meta-default"
          style={position}
        >
          <span>{message}</span>
          {detail && <span>{detail}</span>}
        </span>,
        document.body,
      )}
    </span>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { Button } from "@/components/form-controls";
import {
  AutomationWorkspaceContext,
  useAutomationWorkspace,
  type AutomationWorkspace,
  type HostedInbox,
} from "./automation-context";
import { EmptyState, HostChip, StatusPill } from "./automation-atoms";
import { formatDateTime } from "./automation-format";
import { AutomationIcon } from "./automation-icons";
import { SlideOverDrawer } from "./SlideOverDrawer";
import { InboxResolutionForm } from "./InboxResolutionForm";
import { inboxEntryKey } from "./drawer-utils";

export function InboxDrawer({ initialItem, onClose }: { initialItem: HostedInbox; onClose: () => void }) {
  const { t } = useI18n();
  const workspace = useAutomationWorkspace();
  const { inbox, navigate, nativeConsentPending } = workspace;
  const contentRef = useRef<HTMLDivElement>(null);
  const submissions = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const locked = submitting || nativeConsentPending !== null;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const trackSubmission = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    submissions.current += 1;
    setSubmitting(true);
    try {
      return await operation();
    } finally {
      submissions.current -= 1;
      setSubmitting(submissions.current > 0);
    }
  }, []);
  const resolutionWorkspace: AutomationWorkspace = {
    ...workspace,
    call: (environmentId, method, params) =>
      method === "automation.resolveInbox"
        ? trackSubmission(() => workspace.call(environmentId, method, params))
        : workspace.call(environmentId, method, params),
    command: (command, label) =>
      command.type === "resolve-attention"
        ? trackSubmission(() => workspace.command(command, label))
        : workspace.command(command, label),
  };
  const close = useCallback(() => {
    if (submissions.current === 0 && !lockedRef.current) onClose();
  }, [onClose]);
  useLayoutEffect(() => {
    const button = contentRef.current
      ?.closest('[role="dialog"]')
      ?.querySelector<HTMLButtonElement>(".auto-page-drawer-header button");
    if (button) button.disabled = locked;
  }, [locked]);
  const [selectedKey, setSelectedKey] = useState(() => inboxEntryKey(initialItem));
  const [resolvedKeys, setResolvedKeys] = useState<readonly string[]>([]);
  const [initialFallback, setInitialFallback] = useState<HostedInbox | null>(initialItem);
  const queue = useMemo(() => {
    const items = inbox.filter(
      (entry) => !resolvedKeys.includes(`${inboxEntryKey(entry)}:${entry.item.expectedVersion}`),
    );
    return [...items].sort((a, b) => {
      if (a.item.kind !== b.item.kind) return a.item.kind === "attention" ? -1 : 1;
      const aTime = a.item.kind === "attention" ? a.item.settledAtMs : a.item.openedAtMs;
      const bTime = b.item.kind === "attention" ? b.item.settledAtMs : b.item.openedAtMs;
      return aTime - bTime || inboxEntryKey(a).localeCompare(inboxEntryKey(b));
    });
  }, [inbox, resolvedKeys]);
  const index = queue.findIndex((entry) => inboxEntryKey(entry) === selectedKey);
  const selected =
    index >= 0
      ? queue[index]
      : initialFallback && inboxEntryKey(initialFallback) === selectedKey
        ? initialFallback
        : null;

  useEffect(() => {
    setSelectedKey(inboxEntryKey(initialItem));
    setInitialFallback(initialItem);
  }, [initialItem]);

  useEffect(() => {
    if (index >= 0) setInitialFallback(null);
  }, [index, selectedKey]);

  const resolveCurrent = () => {
    if (!selected) return;
    const key = inboxEntryKey(selected);
    const remaining = queue.filter((entry) => inboxEntryKey(entry) !== key);
    setResolvedKeys((prior) => [...prior, `${key}:${selected.item.expectedVersion}`]);
    setInitialFallback(null);
    setSelectedKey((current) =>
      current === key ? inboxEntryKey(remaining[Math.max(index, 0)] ?? remaining[0] ?? selected) : current,
    );
  };
  const openRun = () => {
    if (!selected || submissions.current > 0 || nativeConsentPending !== null) return;
    navigate({
      view: "run",
      environmentId: selected.environmentId,
      taskId: selected.item.taskId,
      runId: selected.item.runId,
    });
    onClose();
  };
  const go = (next: number) => {
    if (submissions.current === 0 && nativeConsentPending === null && queue[next]) {
      setInitialFallback(null);
      setSelectedKey(inboxEntryKey(queue[next]));
    }
  };

  return (
    <SlideOverDrawer
      title={t("autoPageDrawerInboxTitle", "Inbox")}
      onClose={close}
      footer={
        selected ? (
          <Button variant="ghost" onClick={openRun} disabled={locked}>
            {t("autoPageDrawerOpenFullRun", "Open full run")}
            <AutomationIcon name="right" />
          </Button>
        ) : undefined
      }
    >
      <div ref={contentRef} className="auto-page-drawer-stack">
        <div className="auto-page-inbox-navigation">
          <span className="auto-page-muted type-label-default">
            {t("autoPageDrawerInboxCount", "{count} items · attention first").replace("{count}", String(queue.length))}
          </span>
          <div className="auto-page-actions">
            <Button
              variant="ghost"
              aria-label={t("autoPageDrawerPreviousItem", "Previous inbox item")}
              disabled={index <= 0 || locked}
              onClick={() => go(index - 1)}
            >
              <AutomationIcon name="left" />
            </Button>
            <span className="type-mono-meta">
              {queue.length && index >= 0 ? `${index + 1} / ${queue.length}` : "—"}
            </span>
            <Button
              variant="ghost"
              aria-label={t("autoPageDrawerNextItem", "Next inbox item")}
              disabled={!queue.length || index >= queue.length - 1 || locked}
              onClick={() => go(index + 1)}
            >
              <AutomationIcon name="right" />
            </Button>
          </div>
        </div>
        {selected ? (
          <>
            <div className="auto-page-drawer-heading">
              <div className="auto-page-badges">
                <HostChip environmentId={selected.environmentId} />
                <StatusPill
                  phase={selected.item.kind === "attention" ? "attention" : "waiting"}
                  waitKind={selected.item.kind === "approval" ? "approval" : undefined}
                />
              </div>
              <h2 className="type-title-dialog">
                {selected.item.kind === "approval" ? selected.item.title : selected.item.stepId}
              </h2>
              <p className="auto-page-muted type-body-default">{selected.item.taskName}</p>
              {selected.item.kind === "approval" && selected.item.expiresAtMs !== null && (
                <p className="auto-page-muted type-label-default">
                  {t("autoPageDrawerExpiresAt", "Expires {time}").replace(
                    "{time}",
                    formatDateTime(selected.item.expiresAtMs),
                  )}
                </p>
              )}
            </div>
            <AutomationWorkspaceContext.Provider value={resolutionWorkspace}>
              <InboxResolutionForm entry={selected} onResolved={resolveCurrent} />
            </AutomationWorkspaceContext.Provider>
          </>
        ) : (
          <EmptyState>
            <AutomationIcon name="check" />
            <p className="type-body-medium">
              {queue.length
                ? t("autoPageDrawerInboxSelectionChanged", "This item is no longer in the inbox.")
                : t("autoPageDrawerInboxEmpty", "Nothing left to review.")}
            </p>
            {queue.length > 0 && (
              <Button onClick={() => go(0)}>{t("autoPageDrawerReviewNext", "Review next item")}</Button>
            )}
          </EmptyState>
        )}
      </div>
    </SlideOverDrawer>
  );
}

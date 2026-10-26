import { Button } from "@/components/form-controls";
import { useI18n } from "@/i18n";
import type { InteractiveToolStore, ToolCardEntry } from "@/lib/interactive-tool-store";
import { QuestionChoice } from "./question-fields";
import { CardFooter, FailureBar } from "./tool-card-footer";
import { AutoHeight } from "./tool-motion";

export function OrdinaryForm({
  entry,
  store,
  visible = true,
  onAbandon,
}: {
  entry: ToolCardEntry;
  store: InteractiveToolStore;
  visible?: boolean;
  onAbandon: () => void;
}) {
  const { t } = useI18n();
  const { request, draft } = entry;
  if (request.method === "questionnaire" || request.method === "custom") return null;
  const busy = entry.status === "sending";
  const submit = () => {
    if (!visible) return;
    if (request.method === "confirm") void store.respond(request.id, { confirmed: true });
    else if (request.method === "select") {
      if (draft.selected !== null) void store.respond(request.id, { value: request.options[draft.selected] });
    } else void store.respond(request.id, { value: draft.value });
  };
  const field = {
    value: draft.value,
    disabled: busy,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!visible) return;
      const value = event.target.value;
      store.updateDraft(request.id, (d) => ({ ...d, value }));
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!visible || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && (request.method === "input" || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }
    },
  };
  return (
    <>
      <AutoHeight visible={visible}>
        <div className="tool-form-body type-body-default">
          <h3 className="tool-question-title type-title-dialog">{request.title}</h3>
          {request.method === "confirm" && <p className="tool-description">{request.message}</p>}
          {request.method === "select" && (
            <fieldset className="tool-choices" aria-label={request.title}>
              {request.options.map((option, index) => (
                <QuestionChoice
                  key={index}
                  position={index + 1}
                  label={option}
                  multiSelect={false}
                  name={request.id}
                  checked={draft.selected === index}
                  disabled={busy}
                  onChoose={() => {
                    if (visible) store.updateDraft(request.id, (d) => ({ ...d, selected: index }));
                  }}
                />
              ))}
            </fieldset>
          )}
          {request.method === "input" && (
            <input {...field} aria-label={request.title} placeholder={request.placeholder} />
          )}
          {request.method === "editor" && <textarea {...field} aria-label={request.title} rows={6} />}
        </div>
      </AutoHeight>
      {entry.status === "failed" && <FailureBar />}
      <CardFooter status={entry.status} onAbandon={onAbandon}>
        {request.method === "confirm" && (
          <Button
            disabled={busy}
            onClick={() => {
              if (visible) void store.respond(request.id, { confirmed: false });
            }}
          >
            {t("toolDecline", "Decline")}
          </Button>
        )}
        <Button
          variant="primary"
          busy={busy}
          disabled={busy || (request.method === "select" && draft.selected === null)}
          onClick={submit}
        >
          {entry.status === "failed"
            ? t("toolResend", "Resend")
            : request.method === "confirm"
              ? t("toolConfirm", "Confirm")
              : t("toolSendAnswer", "Send answer")}
        </Button>
      </CardFooter>
    </>
  );
}

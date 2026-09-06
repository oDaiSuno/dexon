import { useI18n } from "@/i18n";
import type { InteractiveToolStore, ToolCardEntry } from "@/lib/interactive-tool-store";
import { AutoHeight } from "./tool-motion";

export function OrdinaryForm({ entry, store }: { entry: ToolCardEntry; store: InteractiveToolStore }) {
  const { t } = useI18n();
  const { request, draft } = entry;
  if (request.method === "questionnaire" || request.method === "custom") return null;
  const busy = entry.status === "sending";
  const submit = () => {
    if (request.method === "confirm") void store.respond(request.id, { confirmed: true });
    else if (request.method === "select") {
      if (draft.selected !== null) void store.respond(request.id, { value: request.options[draft.selected] });
    } else void store.respond(request.id, { value: draft.value });
  };
  const field = {
    value: draft.value,
    disabled: busy,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      store.updateDraft(request.id, (d) => ({ ...d, value }));
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && (request.method === "input" || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }
    },
  };
  return (
    <>
      <AutoHeight>
        <div className="tool-form-body">
          <h3 className="tool-question-title">{request.title}</h3>
          {request.method === "confirm" && <p className="tool-description">{request.message}</p>}
          {request.method === "select" && (
            <fieldset className="tool-options" disabled={busy} aria-label={request.title}>
              {request.options.map((option, index) => (
                <label className="tool-option" key={index} data-selected={draft.selected === index}>
                  <input
                    type="radio"
                    name={request.id}
                    checked={draft.selected === index}
                    onChange={() => store.updateDraft(request.id, (d) => ({ ...d, selected: index }))}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>
          )}
          {request.method === "input" && (
            <input {...field} aria-label={request.title} placeholder={request.placeholder} />
          )}
          {request.method === "editor" && <textarea {...field} aria-label={request.title} rows={6} />}
        </div>
      </AutoHeight>
      <footer className="tool-question-footer tool-footer-end">
        {request.method === "confirm" && (
          <button
            type="button"
            className="tool-pill"
            disabled={busy}
            onClick={() => void store.respond(request.id, { confirmed: false })}
          >
            {t("toolDecline", "Decline")}
          </button>
        )}
        <button
          type="button"
          className="tool-pill tool-primary"
          disabled={busy || (request.method === "select" && draft.selected === null)}
          onClick={submit}
        >
          {busy
            ? t("toolSending", "Sending…")
            : request.method === "confirm"
              ? t("toolConfirm", "Confirm")
              : t("toolSendAnswer", "Send answer")}
        </button>
      </footer>
    </>
  );
}

import { useId, useState, type ChangeEvent } from "react";
import { CheckIcon, EyeIcon, PenLineIcon } from "./tool-card-icons";

export function QuestionChoice({
  position,
  label,
  description,
  preview,
  multiSelect,
  name,
  checked,
  disabled,
  onChoose,
  previewLabels,
  onPreviewToggle,
}: {
  position: number;
  label: string;
  description?: string;
  preview?: string;
  multiSelect: boolean;
  name: string;
  checked: boolean;
  disabled: boolean;
  onChoose: () => void;
  previewLabels?: { show: string; hide: string };
  onPreviewToggle?: () => void;
}) {
  const id = useId();
  const [previewOpen, setPreviewOpen] = useState(false);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const previewId = `${id}-preview`;
  return (
    <label className="tool-choice" data-selected={checked} data-multi={multiSelect} data-disabled={disabled}>
      <input
        className="tool-choice-input"
        type={multiSelect ? "checkbox" : "radio"}
        name={name}
        checked={checked}
        disabled={disabled}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onChange={onChoose}
      />
      <span className="tool-choice-key type-mono-meta" aria-hidden="true">
        {position}
      </span>
      <span className="tool-choice-text">
        <span id={titleId} className="type-body-medium">
          {label}
        </span>
        {description && (
          <span id={descriptionId} className="tool-choice-description type-label-default">
            {description}
          </span>
        )}
        {preview && previewOpen && (
          <pre id={previewId} className="tool-preview type-mono-code" onClick={(event) => event.preventDefault()}>
            {preview}
          </pre>
        )}
      </span>
      <span className="tool-choice-trail">
        {preview && previewLabels && (
          <button
            type="button"
            className="tool-preview-toggle"
            aria-expanded={previewOpen}
            aria-controls={previewOpen ? previewId : undefined}
            aria-describedby={titleId}
            onClick={() => {
              onPreviewToggle?.();
              setPreviewOpen((open) => !open);
            }}
          >
            <EyeIcon size={13} />
            <span className="type-meta-default">{previewOpen ? previewLabels.hide : previewLabels.show}</span>
          </button>
        )}
        {checked && (
          <span className="tool-choice-check" aria-hidden="true">
            <CheckIcon size={16} />
          </span>
        )}
      </span>
    </label>
  );
}

export function OwnAnswer({
  value,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <label className="tool-own-answer type-body-default">
      <span className="tool-own-answer-icon" aria-hidden="true">
        <PenLineIcon size={14} />
      </span>
      <textarea
        value={value}
        disabled={disabled}
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={onChange}
      />
    </label>
  );
}

import { ArrowDownIcon } from "../chat-input/icons";

export function ScrollToBottomButton({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button type="button" className="chat-scroll-to-bottom" onClick={onClick} aria-label={label} title={title}>
      <ArrowDownIcon />
    </button>
  );
}

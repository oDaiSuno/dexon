import { Icon } from "../chat-input/icons";

export { CircleAlertIcon, CircleCheckIcon, CircleXIcon, CloseIcon } from "../chat-input/icons";

export function MessageQuestionIcon({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

export function TimerOffIcon({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M10 2h4" />
      <path d="M4.6 11a8 8 0 0 0 1.7 8.7 8 8 0 0 0 8.7 1.7" />
      <path d="M7.4 7.4a8 8 0 0 1 10.3 1 8 8 0 0 1 .9 10.2" />
      <path d="m2 2 20 20" />
      <path d="M12 12v-2" />
    </Icon>
  );
}

export function ChevronUpIcon({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="m18 15-6-6-6 6" />
    </Icon>
  );
}

export function ChevronDownIcon({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function MinusIcon({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M5 12h14" />
    </Icon>
  );
}

export function ArrowUpRightIcon({ size = 13 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </Icon>
  );
}

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

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2.25}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

export function EyeIcon({ size = 13 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function PenLineIcon({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M13 21h8" />
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
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

export function LoaderCircleIcon({ size = 13 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </Icon>
  );
}

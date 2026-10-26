export interface BrowserShortcutInput {
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export function isBrowserDevToolsShortcut(input: BrowserShortcutInput): boolean {
  const key = input.key.toLowerCase();
  if (input.key.toLowerCase() === "f12") return true;
  if (key !== "i") return false;
  return (input.meta && input.alt) || (input.control && input.shift);
}

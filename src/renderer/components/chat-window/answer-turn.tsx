import { useState, type ReactNode } from "react";
import { TurnFooterView } from "../messages/turn-footer";
import type { TurnFooter } from "./turn-layout";

export function AnswerTurn({
  children,
  footer,
  modelNames,
  onFork,
  forking,
}: {
  children: ReactNode;
  footer: TurnFooter | null;
  modelNames?: Record<string, string>;
  onFork?: (entryId: string) => void;
  forking?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
      {footer && (
        <TurnFooterView footer={footer} hovered={hovered} modelNames={modelNames} onFork={onFork} forking={forking} />
      )}
    </div>
  );
}

import { createContext, useContext, type ReactNode } from "react";

const ReaderActionContext = createContext<() => void>(() => {});

export function ReaderActionProvider({
  onReaderAction,
  children,
}: {
  onReaderAction: () => void;
  children: ReactNode;
}) {
  return <ReaderActionContext.Provider value={onReaderAction}>{children}</ReaderActionContext.Provider>;
}

export function useReaderAction(): () => void {
  return useContext(ReaderActionContext);
}

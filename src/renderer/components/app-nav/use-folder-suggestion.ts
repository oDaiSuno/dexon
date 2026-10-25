import { useEffect, useState } from "react";

export function useFolderSuggestion(
  query: string,
  inspectFolder?: (typed: string) => Promise<string | null>,
): string | null {
  const typed = query.trim();
  const pathLike =
    typed.startsWith("/") || typed.startsWith("~") || /^[a-zA-Z]:[\\/]/.test(typed) || typed.startsWith("\\\\");
  const [found, setFound] = useState<{ typed: string; folder: string } | null>(null);

  useEffect(() => {
    if (!pathLike || !inspectFolder) return;
    let current = true;
    inspectFolder(typed).then(
      (folder) => {
        if (current) setFound(folder ? { typed, folder } : null);
      },
      () => {
        if (current) setFound(null);
      },
    );
    return () => {
      current = false;
    };
  }, [typed, pathLike, inspectFolder]);

  return found && found.typed === typed ? found.folder : null;
}

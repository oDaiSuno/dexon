import { ApiKeyProviderDialog, OAuthProviderDialog } from "./builtin-provider-dialogs";
import { CustomProviderDialog } from "./custom-provider-dialog";
import type { DialogTarget } from "./types";
import type { ModelsConfigEditor } from "./use-models-config";

export function SelectionDetail({
  editor,
  target,
  onClose,
}: {
  editor: ModelsConfigEditor;
  target: DialogTarget | null;
  onClose: () => void;
}) {
  if (!target || editor.loading) return null;
  if (target.type === "oauth") {
    const provider = editor.oauthProviders.find((p) => p.id === target.providerId);
    return provider ? (
      <OAuthProviderDialog
        key={provider.id}
        editor={editor}
        provider={provider}
        startLogin={target.startLogin ?? false}
        onClose={onClose}
      />
    ) : null;
  }
  if (target.type === "apikey") {
    const provider = editor.apiKeyProviders.find((p) => p.id === target.providerId);
    return provider ? (
      <ApiKeyProviderDialog key={provider.id} editor={editor} provider={provider} onClose={onClose} />
    ) : null;
  }
  if (target.name !== null && !editor.config.providers?.[target.name]) return null;
  return (
    <CustomProviderDialog key={target.name ?? "new"} editor={editor} originalName={target.name} onClose={onClose} />
  );
}

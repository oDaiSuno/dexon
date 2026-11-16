import type { ModelCatalogScope } from "@contract/types";

export interface ModelPickerStatus {
  modelCatalogScope?: ModelCatalogScope | null;
  modelLoading?: boolean;
  modelReconnecting?: boolean;
  modelLoadError?: string | null;
}

export type PickerBodyState<TGroup> =
  | { readonly kind: "loading" }
  | { readonly kind: "reconnecting"; readonly hasCachedList: boolean; readonly cachedGroups: readonly TGroup[] }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "empty-catalog" }
  | { readonly kind: "no-match"; readonly query: string }
  | { readonly kind: "list"; readonly groups: readonly TGroup[] };

export function deriveModelPickerBodyState<TGroup>({
  groups,
  visible,
  query,
  modelLoading = false,
  modelRefreshing = false,
  modelReconnecting = false,
  modelLoadError = null,
}: ModelPickerStatus & {
  groups: readonly TGroup[];
  visible: readonly TGroup[];
  query: string;
  modelRefreshing?: boolean;
}): PickerBodyState<TGroup> {
  if (modelReconnecting) return { kind: "reconnecting", hasCachedList: groups.length > 0, cachedGroups: visible };
  if (groups.length === 0) {
    if (modelLoading || modelRefreshing) return { kind: "loading" };
    if (modelLoadError) return { kind: "failed", message: modelLoadError };
    return { kind: "empty-catalog" };
  }
  if (visible.length > 0) return { kind: "list", groups: visible };
  return query.trim() ? { kind: "no-match", query } : { kind: "empty-catalog" };
}

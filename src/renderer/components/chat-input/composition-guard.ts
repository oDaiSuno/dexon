export const COMPOSITION_END_ENTER_GRACE_MS = 100;

export interface CompositionState {
  composing: boolean;
  endedAt: number;
}

export type CompositionEnterAction = "send" | "swallow" | "prevent";

export function compositionEnterAction(
  nativeEvent: { isComposing?: boolean; keyCode?: number },
  state: CompositionState,
  now: number,
): CompositionEnterAction {
  const recentlyComposed = now - state.endedAt < COMPOSITION_END_ENTER_GRACE_MS;
  const composing = state.composing || nativeEvent.isComposing === true || nativeEvent.keyCode === 229;
  if (!composing && !recentlyComposed) return "send";
  return recentlyComposed ? "prevent" : "swallow";
}

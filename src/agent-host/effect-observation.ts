export type EffectErrorCode =
  | "invalid_input"
  | "grant_violation"
  | "script_changed"
  | "missing_secret"
  | "unreachable"
  | "timeout"
  | "aborted"
  | "http_status"
  | "provider_rejected"
  | "transport"
  | "host_interrupted"
  | "crash_loop"
  | "agent_no_result"
  | "model_unavailable"
  | "output_too_large"
  | "internal";

export interface EffectError {
  readonly code: EffectErrorCode;
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type EffectObservation<O> =
  | { readonly kind: "applied"; readonly output: O }
  | { readonly kind: "not_applied"; readonly error: EffectError; readonly transient: boolean }
  | { readonly kind: "maybe_applied"; readonly error: EffectError };

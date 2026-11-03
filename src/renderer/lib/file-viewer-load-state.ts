export interface TextFileData {
  content: string;
  language: string;
  size: number;
  space?: "local" | "remote" | "local-overlay";
  remoteHostLabel?: string;
}

export type TextFileLoadState =
  | { status: "loading"; data: null; error: null }
  | { status: "error"; data: null; error: string }
  | { status: "ready"; data: TextFileData; error: null };

export type TextFileLoadAction =
  | { type: "reset" }
  | { type: "failed"; error: string; retainSnapshot?: boolean }
  | { type: "succeeded"; data: TextFileData };

export const INITIAL_TEXT_FILE_LOAD_STATE: TextFileLoadState = {
  status: "loading",
  data: null,
  error: null,
};

export function textFileLoadReducer(state: TextFileLoadState, action: TextFileLoadAction): TextFileLoadState {
  switch (action.type) {
    case "reset":
      return INITIAL_TEXT_FILE_LOAD_STATE;
    case "failed":
      return action.retainSnapshot && state.status === "ready"
        ? state
        : { status: "error", data: null, error: action.error };
    case "succeeded":
      return { status: "ready", data: action.data, error: null };
    default:
      return state;
  }
}

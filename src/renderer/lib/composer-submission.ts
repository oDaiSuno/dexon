export interface ComposerSubmissionSnapshot {
  value: string;
}

export function captureComposerSubmission(value: string): ComposerSubmissionSnapshot {
  return { value };
}

export function failedComposerSubmissionAction(
  clearedAtRevision: number,
  currentRevision: number,
): "restore" | "preserve" {
  return clearedAtRevision === currentRevision ? "restore" : "preserve";
}

/** Rebuild the failed message text from the snapshot (token references included). */
export function failedComposerSubmissionValue(snapshot: ComposerSubmissionSnapshot): string {
  return snapshot.value;
}

import { ERROR_MESSAGES, UpdateManagerError, type UpdateOperation } from "./update-errors.ts";

export class UpdateOperationSlot {
  private active: { kind: UpdateOperation; promise: Promise<unknown> } | null = null;

  get kind(): UpdateOperation | undefined {
    return this.active?.kind;
  }

  reuseOrReject<Result>(kind: UpdateOperation): Promise<Result> | null {
    if (!this.active) return null;
    if (this.active.kind === kind) return this.active.promise as Promise<Result>;
    return Promise.reject(new UpdateManagerError("UPDATE_BUSY", ERROR_MESSAGES.UPDATE_BUSY));
  }

  track<Result>(kind: UpdateOperation, run: () => Promise<Result>): Promise<Result> {
    let resolveOperation: (value: Result | PromiseLike<Result>) => void = () => undefined;
    let rejectOperation: (reason?: unknown) => void = () => undefined;
    const promise = new Promise<Result>((resolve, reject) => {
      resolveOperation = resolve;
      rejectOperation = reject;
    });
    this.active = { kind, promise };
    let result: Promise<Result>;
    try {
      result = run();
    } catch (error) {
      rejectOperation(error);
      result = Promise.reject(error);
    }
    void result.then(resolveOperation, rejectOperation);
    void promise.then(
      () => {
        if (this.active?.promise === promise) this.active = null;
      },
      () => {
        if (this.active?.promise === promise) this.active = null;
      },
    );
    return promise;
  }
}

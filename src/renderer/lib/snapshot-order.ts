declare const ticketBrand: unique symbol;
export type SnapshotTicket = number & { readonly [ticketBrand]: true };

export type HistoryAdmission = { admitted: false } | { admitted: true; resetHistory: boolean };
export type RuntimeAdmission<R> = { current: boolean; latest: R | null };

export class SnapshotOrder<R> {
  #issued = 0;
  #history = 0;
  #runtime = 0;
  #resetUpTo = 0;
  #latestRuntime: R | null = null;

  reset(): void {
    this.#history = this.#issued;
    this.#runtime = this.#issued;
    this.#resetUpTo = this.#issued;
    this.#latestRuntime = null;
  }

  issue(options: { resetHistory: boolean }): SnapshotTicket {
    const ticket = ++this.#issued;
    if (options.resetHistory) this.#resetUpTo = ticket;
    return ticket as SnapshotTicket;
  }

  canCommit(ticket: SnapshotTicket): boolean {
    return ticket > this.#history;
  }

  admitHistory(ticket: SnapshotTicket): HistoryAdmission {
    if (ticket <= this.#history) return { admitted: false };
    const resetHistory = this.#resetUpTo > this.#history;
    this.#history = ticket;
    return { admitted: true, resetHistory };
  }

  admitRuntime(ticket: SnapshotTicket, state: R | null): RuntimeAdmission<R> {
    if (ticket <= this.#runtime) return { current: false, latest: this.#latestRuntime };
    this.#runtime = ticket;
    this.#latestRuntime = state;
    return { current: true, latest: state };
  }
}

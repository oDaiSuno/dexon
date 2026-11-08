export interface QueuedTurn {
  readonly sourceSessionId?: string;
  cancel(): void;
}

export class QueuedTurns {
  private readonly turns = new Set<QueuedTurn>();

  add(turn: QueuedTurn): () => void {
    this.turns.add(turn);
    return () => this.turns.delete(turn);
  }

  cancelAll(): void {
    for (const turn of this.turns) {
      turn.cancel();
    }
    this.turns.clear();
  }

  cancelFrom(sourceSessionId: string): void {
    for (const turn of this.turns) {
      if (turn.sourceSessionId === sourceSessionId) turn.cancel();
    }
  }
}

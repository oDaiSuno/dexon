export interface ReadingPosition {
  key: string;
  offsetTop: number;
}

export class ReadingPositionRegistry {
  private readonly positions = new Map<string, ReadingPosition>();

  get(sessionId: string): ReadingPosition | null {
    return this.positions.get(sessionId) ?? null;
  }

  set(sessionId: string, position: ReadingPosition): void {
    this.positions.set(sessionId, { key: position.key, offsetTop: position.offsetTop });
  }

  delete(sessionId: string): void {
    this.positions.delete(sessionId);
  }
}

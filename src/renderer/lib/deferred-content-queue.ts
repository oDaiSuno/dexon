export const DEFERRED_CONTENT_CONCURRENCY = 2;

export class DeferredContentQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number = DEFERRED_CONTENT_CONCURRENCY) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.startNext();
          });
      };
      if (this.active < this.limit) start();
      else this.waiting.push(start);
    });
  }

  private startNext(): void {
    while (this.active < this.limit) {
      const start = this.waiting.shift();
      if (!start) return;
      start();
    }
  }
}

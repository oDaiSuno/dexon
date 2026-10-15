// JSDOM has no native layout observers. Deliver browser signals by DOM
// target, never by selecting an application's internal observer instance.
export function createBrowserObservers() {
  const resizeObservers = new Set();
  class ResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      resizeObservers.add(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    unobserve(target) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
    }
  }
  const intersectionObservers = new Set();
  class IntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      intersectionObservers.add(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    unobserve(target) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
    }
  }
  return {
    ResizeObserver,
    IntersectionObserver,
    intersect(target, isIntersecting) {
      for (const observer of intersectionObservers) {
        if (observer.targets.has(target)) observer.callback([{ target, isIntersecting }], observer);
      }
    },
    intersectionTargets: () => new Set([...intersectionObservers].flatMap((observer) => [...observer.targets])),
    resize(target, contentRect = { width: 0, height: 0 }) {
      for (const observer of resizeObservers) {
        if (observer.targets.has(target)) observer.callback([{ target, contentRect }], observer);
      }
    },
    resizeTargets: () => new Set([...resizeObservers].flatMap((observer) => [...observer.targets])),
  };
}

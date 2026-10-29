import '@testing-library/jest-dom/vitest';

type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;

let intersectionCallbacks: IntersectionCallback[] = [];

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds: readonly number[] = [0];

  constructor(callback: IntersectionCallback) {
    intersectionCallbacks.push(callback);
  }

  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
});

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  },
});

export const triggerIntersection = (isIntersecting = true): void => {
  intersectionCallbacks.forEach(callback =>
    callback([{ isIntersecting } as IntersectionObserverEntry]),
  );
};

export const resetIntersections = (): void => {
  intersectionCallbacks = [];
};

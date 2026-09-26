// Tiny async mutex: serializes read-modify-write cycles on the JSON stores
// so concurrent turns (tool call + background consolidation) can't lose writes.

export function createMutex() {
  let tail: Promise<void> = Promise.resolve();
  return async function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = tail.then(fn);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

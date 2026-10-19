export const SPLIT_DIVIDER_WIDTH = 8;
export const MIN_PANE_WIDTH = 240;

export function clampSplitRatio(ratio: number, containerWidth = Infinity): number {
  const available = Math.max(0, containerWidth - SPLIT_DIVIDER_WIDTH);
  const minimum = Number.isFinite(containerWidth)
    ? Math.min(0.5, Math.max(0.1, available > 0 ? MIN_PANE_WIDTH / available : 0.5)) : 0.1;
  return Math.max(minimum, Math.min(1 - minimum, Number.isFinite(ratio) ? ratio : 0.5));
}

export function splitRatioFromPointer(clientX: number, containerLeft: number,
  containerWidth: number, grabOffset = SPLIT_DIVIDER_WIDTH / 2): number {
  const available = containerWidth - SPLIT_DIVIDER_WIDTH;
  if (!Number.isFinite(clientX) || available <= 0) return 0.5;
  return clampSplitRatio((clientX - containerLeft - grabOffset) / available, containerWidth);
}

// Keep only the newest waiting layout while a native resize is in progress.
export function createLatestTaskRunner() {
  let pending: (() => Promise<void>) | undefined;
  let running = false;
  async function drain() {
    running = true;
    try {
      while (pending) {
        const task = pending;
        pending = undefined;
        await task();
      }
    } finally { running = false; }
  }
  return (task: () => Promise<void>) => {
    pending = task;
    if (!running) void drain();
  };
}

// A 14px favicon, 4px padding on each side, and the two borders.
export const MIN_TAB_WIDTH = 24;
export const MAX_TAB_WIDTH = 176;
export const TAB_GAP = 4;

export function overflowButtonWidth(count: number): number {
  return count > 0 ? 40 + Math.max(0, String(count).length - 1) * 8 : 0;
}

// Each group contains one page or an indivisible linked pair. Reserve the
// counter before choosing the last complete group that fits.
export function fitTabGroups(groups: { id: string; preferred: number[] }[], available: number) {
  const capacity = Math.max(0, available);
  const minimums = [0];
  for (const group of groups) minimums.push(minimums[minimums.length - 1] + group.preferred.length * MIN_TAB_WIDTH + TAB_GAP);
  let visibleCount = groups.length;
  if (minimums[visibleCount] > capacity) {
    visibleCount = 0;
    for (let count = 1; count <= groups.length; count++) {
      if (minimums[count] + overflowButtonWidth(groups.length - count) > capacity) break;
      visibleCount = count;
    }
  }
  const hiddenCount = groups.length - visibleCount;
  const counterWidth = overflowButtonWidth(hiddenCount);
  const visible = groups.slice(0, visibleCount);
  const gaps = visible.length * TAB_GAP;
  const widths = fitTabWidths(visible.flatMap((group) => group.preferred), Math.max(0, capacity - counterWidth - gaps));
  return { visibleCount, hiddenCount, counterWidth, widths,
    stripWidth: widths.reduce((sum, width) => sum + width, gaps) };
}

// Measure capacity without the brand label so hiding it cannot cause a resize
// loop. Reclaim that label only after the tabs have exhausted their minimums.
export function fitTabBar(groups: { id: string; preferred: number[] }[], capacity: number, titleWidth: number) {
  const minimum = groups.reduce((sum, group) => sum + group.preferred.length * MIN_TAB_WIDTH + TAB_GAP, 0);
  const hideTitle = minimum > Math.max(0, capacity - titleWidth);
  return { ...fitTabGroups(groups, capacity - (hideTitle ? 0 : titleWidth)), hideTitle };
}

export function naturalTabWidth(titleWidth: number, linkedFirst: boolean, muted = false): number {
  // Padding, borders, favicon, gaps, and (except before a chain) the close button.
  const chrome = (linkedFirst ? 48 : 72) + (muted ? 20 : 0);
  return Math.max(MIN_TAB_WIDTH, Math.min(MAX_TAB_WIDTH, Math.ceil(Math.max(0, titleWidth)) + chrome));
}

// Lower the shared width ceiling as the bar fills. Short tabs keep their natural
// width until the longer tabs have shrunk to the same size.
export function fitTabWidths(preferred: number[], available: number): number[] {
  const widths = preferred.map((width) => Math.max(MIN_TAB_WIDTH,
    Math.min(MAX_TAB_WIDTH, Number.isFinite(width) ? width : MAX_TAB_WIDTH)));
  if (!widths.length || widths.reduce((sum, width) => sum + width, 0) <= available) return widths;
  if (available <= widths.length * MIN_TAB_WIDTH) return widths.map(() => MIN_TAB_WIDTH);
  let low = MIN_TAB_WIDTH;
  let high = MAX_TAB_WIDTH;
  for (let step = 0; step < 32; step++) {
    const ceiling = (low + high) / 2;
    if (widths.reduce((sum, width) => sum + Math.min(width, ceiling), 0) > available) high = ceiling;
    else low = ceiling;
  }
  return widths.map((width) => Math.min(width, low));
}

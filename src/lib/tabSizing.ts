export const MIN_TAB_WIDTH = 80;
export const MAX_TAB_WIDTH = 176;
export const TAB_GAP = 4;
export const TAB_DRAG_SPACE = 30;

export function naturalTabWidth(titleWidth: number, linkedFirst: boolean): number {
  // Padding, borders, favicon, gaps, and (except before a chain) the close button.
  const chrome = linkedFirst ? 48 : 72;
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

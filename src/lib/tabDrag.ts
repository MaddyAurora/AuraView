export interface TabDragItem { id: string; left: number; width: number }

// The linked pair is one item, even though its two page cards stay mounted separately.
export function tabDragPlacement(items: TabDragItem[], id: string, delta: number) {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return { index: -1, offsets: new Map<string, number>() };
  const dragged = items[from];
  const start = items[0].left;
  const end = Math.max(...items.map((item) => item.left + item.width));
  const offset = Math.max(start - dragged.left,
    Math.min(end - dragged.left - dragged.width, Number.isFinite(delta) ? delta : 0));
  // Compare the leading edge with neighbor centers. A wide split pair must
  // still be able to cross a narrow tab at either end of the strip.
  let index = from;
  if (offset > 0) {
    const edge = dragged.left + dragged.width + offset;
    for (let i = from + 1; i < items.length; i++) {
      if (edge > items[i].left + items[i].width / 2) index = i;
    }
  } else if (offset < 0) {
    const edge = dragged.left + offset;
    for (let i = from - 1; i >= 0; i--) {
      if (edge < items[i].left + items[i].width / 2) index = i;
    }
  }
  const offsets = new Map(items.map((item, i) => [item.id,
    i === from ? offset : i > from && i <= index ? -dragged.width : i < from && i >= index ? dragged.width : 0]));
  return { index, offsets };
}

export function tabDragScrollVelocity(clientX: number, left: number, right: number): number {
  const edge = Math.min(40, (right - left) / 4);
  if (edge <= 0) return 0;
  if (clientX < left + edge) return -900 * Math.min(1, (left + edge - clientX) / edge);
  if (clientX > right - edge) return 900 * Math.min(1, (clientX - right + edge) / edge);
  return 0;
}

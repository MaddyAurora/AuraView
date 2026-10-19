import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { Tab } from '../types/browser';
import { orderedTabPages } from '../lib/tabState';
import { fitTabWidths, naturalTabWidth, TAB_DRAG_SPACE, TAB_GAP } from '../lib/tabSizing';

interface TabSizes { widths: Record<string, number>; stripWidth?: number }

export function useTabSizing(areaRef: RefObject<HTMLDivElement>, stripRef: RefObject<HTMLDivElement>,
  newTabRef: RefObject<HTMLButtonElement>, tabs: Tab[], frozen: boolean) {
  const [sizes, setSizes] = useState<TabSizes>({ widths: {} });
  const pages = tabs.flatMap((tab) => {
    const ordered = orderedTabPages(tab);
    const visible = tab.splitEnabled ? ordered : ordered.slice(0, 1);
    return visible.map(({ page }, index) => ({ id: page.id, title: page.title,
      linkedFirst: visible.length === 2 && index === 0 }));
  });
  const signature = JSON.stringify(pages);

  useLayoutEffect(() => {
    const area = areaRef.current;
    const strip = stripRef.current;
    const button = newTabRef.current;
    if (!area || !strip || !button || frozen) return;
    let disposed = false;
    const titles = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-title]'));
    const measure = () => {
      if (disposed) return;
      const buttonStyle = getComputedStyle(button);
      const buttonWidth = button.getBoundingClientRect().width + (parseFloat(buttonStyle.marginLeft) || 0)
        + (parseFloat(buttonStyle.marginRight) || 0);
      const capacity = Math.max(0, area.clientWidth - buttonWidth - TAB_DRAG_SPACE);
      const titleWidths = new Map(titles.map((title) => [title.dataset.tabTitle!, title.getBoundingClientRect().width]));
      const preferred = pages.map((page) => naturalTabWidth(titleWidths.get(page.id) ?? 100, page.linkedFirst));
      const gaps = pages.filter((page) => !page.linkedFirst).length * TAB_GAP;
      const fitted = fitTabWidths(preferred, Math.max(0, capacity - gaps));
      const widths = Object.fromEntries(pages.map((page, index) => [page.id, fitted[index]]));
      const stripWidth = Math.min(capacity, fitted.reduce((sum, width) => sum + width, gaps));
      setSizes((previous) => {
        const same = previous.stripWidth !== undefined && Math.abs(previous.stripWidth - stripWidth) < 0.1
          && Object.keys(previous.widths).length === pages.length
          && pages.every((page) => Math.abs((previous.widths[page.id] ?? -1) - widths[page.id]) < 0.1);
        return same ? previous : { widths, stripWidth };
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    observer.observe(button);
    for (const title of titles) observer.observe(title);
    measure();
    return () => { disposed = true; observer.disconnect(); };
  }, [signature, frozen]);

  return sizes;
}

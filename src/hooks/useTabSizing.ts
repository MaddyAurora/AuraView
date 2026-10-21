import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { Tab } from '../types/browser';
import { orderedTabPages } from '../lib/tabState';
import { fitTabGroups, naturalTabWidth, TAB_DRAG_SPACE } from '../lib/tabSizing';

interface TabSizes { widths: Record<string, number>; stripWidth?: number; visibleCount?: number }

export function useTabSizing(areaRef: RefObject<HTMLDivElement>, stripRef: RefObject<HTMLDivElement>,
  newTabRef: RefObject<HTMLButtonElement>, tabs: Tab[], frozen: boolean) {
  const [sizes, setSizes] = useState<TabSizes>({ widths: {} });
  const groups = tabs.map((tab) => {
    const ordered = orderedTabPages(tab);
    const visible = tab.splitEnabled ? ordered : ordered.slice(0, 1);
    return { id: tab.id, pages: visible.map(({ page }, index) => ({ id: page.id, title: page.title,
      linkedFirst: visible.length === 2 && index === 0 })) };
  });
  const signature = JSON.stringify(groups);

  useLayoutEffect(() => {
    const area = areaRef.current;
    const strip = stripRef.current;
    const button = newTabRef.current;
    if (!area || !strip || !button || frozen) return;
    let disposed = false;
    const titles = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-title]'));
    const context = document.createElement('canvas').getContext('2d');
    const measure = () => {
      if (disposed) return;
      const buttonStyle = getComputedStyle(button);
      const buttonWidth = button.getBoundingClientRect().width + (parseFloat(buttonStyle.marginLeft) || 0)
        + (parseFloat(buttonStyle.marginRight) || 0);
      const capacity = Math.max(0, area.clientWidth - buttonWidth - TAB_DRAG_SPACE);
      if (context && titles[0]) context.font = getComputedStyle(titles[0]).font;
      const titleWidths = new Map(titles.map((title) => [title.dataset.tabTitle!, title.getBoundingClientRect().width]));
      const fitted = fitTabGroups(groups.map((group) => ({ id: group.id,
        preferred: group.pages.map((page) => naturalTabWidth(titleWidths.get(page.id)
          || context?.measureText(page.title).width || 100, page.linkedFirst)) })), capacity);
      const pages = groups.slice(0, fitted.visibleCount).flatMap((group) => group.pages);
      const widths = Object.fromEntries(pages.map((page, index) => [page.id, fitted.widths[index]]));
      const { stripWidth, visibleCount } = fitted;
      setSizes((previous) => {
        const same = previous.stripWidth !== undefined && Math.abs(previous.stripWidth - stripWidth) < 0.1
          && previous.visibleCount === visibleCount
          && Object.keys(previous.widths).length === pages.length
          && pages.every((page) => Math.abs((previous.widths[page.id] ?? -1) - widths[page.id]) < 0.1);
        return same ? previous : { widths, stripWidth, visibleCount };
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

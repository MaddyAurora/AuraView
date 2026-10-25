import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Tab } from '../types/browser';
import { orderedTabPages } from '../lib/tabState';
import { fitTabBar, naturalTabWidth } from '../lib/tabSizing';

interface TabSizes { widths: Record<string, number>; stripWidth?: number; visibleCount?: number; hideTitle?: boolean }
interface TabMeasurements { capacity?: number; brandTitleWidth?: number; titleWidths: Map<string, number> }

export function useTabSizing(areaRef: RefObject<HTMLDivElement>, stripRef: RefObject<HTMLDivElement>,
  newTabRef: RefObject<HTMLButtonElement>, tabs: Tab[], frozen: boolean, brandTitleRef: RefObject<HTMLSpanElement>) {
  const [measurements, setMeasurements] = useState<TabMeasurements>({ titleWidths: new Map() });
  const sizes = useRef<TabSizes>({ widths: {} });
  const groups = tabs.map((tab) => {
    const ordered = orderedTabPages(tab);
    const visible = tab.splitEnabled ? ordered : ordered.slice(0, 1);
    return { id: tab.id, pages: visible.map(({ page }, index) => ({ id: page.id, title: page.title,
      isMuted: Boolean(page.isMuted),
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
      const brandTitle = brandTitleRef.current;
      const brandTitleWidth = brandTitle?.firstElementChild?.getBoundingClientRect().width ?? 0;
      // The wrapper collapses; its child remains measurable even while hidden.
      const capacity = Math.max(0, area.getBoundingClientRect().width
        + (brandTitle?.getBoundingClientRect().width ?? 0) - buttonWidth);
      if (context && titles[0]) context.font = getComputedStyle(titles[0]).font;
      const renderedWidths = new Map(titles.map((title) => [title.dataset.tabTitle!, title.getBoundingClientRect().width]));
      const measured = groups.flatMap((group) => group.pages.map((page) => ({ title: page.title,
        width: renderedWidths.get(page.id) || context?.measureText(page.title).width || 100 })));
      setMeasurements((previous) => {
        const same = previous.capacity !== undefined && Math.abs(previous.capacity - capacity) < 0.1
          && Math.abs((previous.brandTitleWidth ?? 0) - brandTitleWidth) < 0.1
          && measured.every((page) => Math.abs((previous.titleWidths.get(page.title) ?? -1) - page.width) < 0.1);
        if (same) return previous;
        // Cache by title rather than native identity: reopening uses fresh IDs,
        // but can immediately reuse the closed page's intrinsic text width.
        const titleWidths = new Map(previous.titleWidths);
        for (const page of measured) { titleWidths.delete(page.title); titleWidths.set(page.title, page.width); }
        while (titleWidths.size > Math.max(256, measured.length)) titleWidths.delete(titleWidths.keys().next().value!);
        return { capacity, brandTitleWidth, titleWidths };
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    observer.observe(button);
    if (brandTitleRef.current) {
      observer.observe(brandTitleRef.current);
      if (brandTitleRef.current.firstElementChild) observer.observe(brandTitleRef.current.firstElementChild);
    }
    for (const title of titles) observer.observe(title);
    measure();
    return () => { disposed = true; observer.disconnect(); };
  }, [signature, frozen]);

  if (!frozen) {
    // Fit the current list on its first render. A count saved for the previous
    // list would hide existing trailing pages when a tab is inserted before them.
    const fitted = fitTabBar(groups.map((group) => ({ id: group.id,
      preferred: group.pages.map((page) => naturalTabWidth(measurements.titleWidths.get(page.title) ?? 100,
        page.linkedFirst, page.isMuted)) })), measurements.capacity ?? Infinity, measurements.brandTitleWidth ?? 0);
    const pages = groups.slice(0, fitted.visibleCount).flatMap((group) => group.pages);
    sizes.current = { widths: Object.fromEntries(pages.map((page, index) => [page.id, fitted.widths[index]])),
      stripWidth: fitted.stripWidth, visibleCount: fitted.visibleCount, hideTitle: fitted.hideTitle };
  }
  return sizes.current;
}

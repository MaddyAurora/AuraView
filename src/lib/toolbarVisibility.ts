export const TOOLBAR_VISIBILITY_KEY = 'auraview.toolbar-visibility.v1';
export interface ToolbarVisibility { showAiDock: boolean; showBookmarks: boolean }

export function loadToolbarVisibility(storage: Pick<Storage, 'getItem'>): ToolbarVisibility {
  try {
    const value = JSON.parse(storage.getItem(TOOLBAR_VISIBILITY_KEY) || '{}');
    return { showAiDock: value?.showAiDock === true, showBookmarks: value?.showBookmarks === true };
  } catch {
    // An unavailable or malformed preference must not prevent opening the browser.
    return { showAiDock: false, showBookmarks: false };
  }
}

export function saveToolbarVisibility(storage: Pick<Storage, 'setItem'>, value: ToolbarVisibility): void {
  storage.setItem(TOOLBAR_VISIBILITY_KEY, JSON.stringify(value));
}

export const THEME_KEY = 'auraview.theme.v1';
export const themes = [
  { id: 'aura', name: 'Aura', base: '#090c10', accent: '#22d3ee' },
  { id: 'ocean', name: 'Ocean', base: '#071629', accent: '#38bdf8' },
  { id: 'violet', name: 'Violet', base: '#1a1029', accent: '#c084fc' },
  { id: 'rose', name: 'Rose', base: '#29121e', accent: '#fb7185' },
  { id: 'forest', name: 'Forest', base: '#0c2019', accent: '#4ade80' },
  { id: 'ember', name: 'Ember', base: '#26180f', accent: '#fb923c' },
] as const;

export type ThemeId = typeof themes[number]['id'];
export function readTheme(): ThemeId {
  try { return themes.find((theme) => theme.id === localStorage.getItem(THEME_KEY))?.id ?? 'aura'; }
  catch { return 'aura'; }
}
export function applyTheme(id: ThemeId) {
  const theme = themes.find((item) => item.id === id) ?? themes[0];
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.setProperty('--theme-base', theme.base);
  document.documentElement.style.setProperty('--theme-accent', theme.accent);
}
export function saveTheme(id: ThemeId) {
  localStorage.setItem(THEME_KEY, id);
  applyTheme(id);
  window.dispatchEvent(new Event('auraview-theme-changed'));
}
export function initializeTheme() {
  const update = () => applyTheme(readTheme());
  update();
  window.addEventListener('storage', update);
  window.addEventListener('auraview-theme-changed', update);
}

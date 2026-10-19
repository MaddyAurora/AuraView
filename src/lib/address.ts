export function resolveAddress(input: string): string | undefined {
  const target = input.trim();
  if (!target) return;
  if (/^\d{2,5}$/.test(target)) return `http://localhost:${target}`;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(target)) return `http://${target}`;
  if (/^https?:\/\//i.test(target)) return target;
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(target)) return `https://${target}`;
  return `https://www.google.com/search?q=${encodeURIComponent(target)}`;
}

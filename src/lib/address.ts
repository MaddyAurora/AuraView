export function resolveAddress(input: string): string | undefined {
  const target = input.trim();
  if (!target) return;
  // Windows "Copy as path" may include quotes. Encode raw file paths by
  // segment so spaces, #, ? and % remain part of the filename, not a search
  // query or URL fragment. Already-formed file URLs retain their URL semantics.
  const local = /^".*"$/.test(target) ? target.slice(1, -1) : target;
  if (/^[a-z]:[\\/]/i.test(local)) {
    const path = local.replace(/\\/g, '/');
    return new URL(`file:///${path[0].toUpperCase()}:/${path.slice(3).split('/').map(encodeURIComponent).join('/')}`).href;
  }
  if (/^file:/i.test(local)) {
    try { return new URL(local).href; } catch { return; }
  }
  if (/^\d{2,5}$/.test(target)) return `http://localhost:${target}`;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(target)) return `http://${target}`;
  if (/^https?:\/\//i.test(target)) return target;
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(target)) return `https://${target}`;
  return `https://www.google.com/search?q=${encodeURIComponent(target)}`;
}

// Keep bookmark icons self-contained. Remote URLs would make every bookmark
// request a website again, and SVG/HTML payloads do not belong in saved icons.
export function faviconData(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 180_000) return;
  const match = /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  return match && match[1].length % 4 === 0 ? value : undefined;
}

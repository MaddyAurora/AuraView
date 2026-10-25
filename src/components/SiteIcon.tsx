import { useState } from 'react';
import type { ReactNode } from 'react';
import { faviconData } from '../lib/favicon';

export function SiteIcon({ favicon, fallback }: { favicon?: string; fallback: ReactNode }) {
  const source = faviconData(favicon);
  const [failed, setFailed] = useState<string>();
  if (!source || failed === source) return <>{fallback}</>;
  return <img src={source} alt="" aria-hidden="true" draggable={false} referrerPolicy="no-referrer"
    className="h-3.5 w-3.5 shrink-0 object-contain" onError={() => setFailed(source)} />;
}

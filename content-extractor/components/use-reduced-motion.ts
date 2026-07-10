'use client';

import { useSyncExternalStore } from 'react';

// prefers-reduced-motion là external system → useSyncExternalStore (không setState trong
// effect, khớp rule react-hooks/set-state-in-effect). Dùng chung: trang video + ShotPreview.
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

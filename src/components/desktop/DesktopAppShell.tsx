import type { ReactNode } from 'react';

// Native screens keep their existing navigation and safe-area hierarchy.
export function DesktopAppShell({ children }: { children: ReactNode }) {
  return children;
}

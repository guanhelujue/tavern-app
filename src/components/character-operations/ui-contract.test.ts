/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const modalSource = readFileSync(
  fileURLToPath(new URL('./CharacterOperationsModal.tsx', import.meta.url)),
  'utf8',
);

describe('character operations UI contract', () => {
  it('keeps the tab rail fixed while every operations page owns the remaining height', () => {
    expect(modalSource).toContain('style={styles.tabsViewport}');
    expect(modalSource).toMatch(
      /tabsViewport:\s*\{[^}]*height:\s*68[^}]*flexGrow:\s*0[^}]*flexShrink:\s*0/s,
    );
    expect(modalSource.match(/style=\{styles\.flexBody\}\s+contentContainerStyle=\{styles\.scrollBody\}/g))
      .toHaveLength(4);
  });
});

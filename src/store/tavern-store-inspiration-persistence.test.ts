/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const storeSource = read('./tavern-store.ts');
const modalSource = read('../components/NovelSceneInspirationModal.tsx');

describe('novel inspiration chat persistence', () => {
  it('stores per-novel inspiration messages in the persisted Zustand snapshot', () => {
    expect(storeSource).toContain('novelInspirationChats: Record<string, SceneInspirationChatMessage[]>');
    expect(storeSource).toContain('novelInspirationChats: state.novelInspirationChats');
    expect(modalSource).toContain('state.novelInspirationChats[novel.id]');
    expect(modalSource).not.toContain("useState<SceneInspirationChatMessage[]>([])");
  });
});

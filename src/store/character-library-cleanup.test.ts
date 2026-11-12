/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const storeSource = read('./tavern-store.ts');
const castEditorSource = read('../components/novel-create/NovelCastEditor.tsx');
const characterLibrarySource = read('../app/novel/knowledge/characters/[novelId].tsx');
const portraitPickerSource = read('../components/CharacterPortraitPickerModal.tsx');
const portraitUtilsSource = read('../utils/character-card-portraits.ts');

describe('character library cleanup', () => {
  it('does not cap character collections in the store or editors', () => {
    expect(storeSource).not.toContain('maxNovelCast');
    expect(storeSource).not.toContain('MAX_NOVEL_CAST');
    expect(castEditorSource).not.toContain('maxNovelCast');
    expect(characterLibrarySource).not.toContain('maxNovelCast');
  });

  it('offers only character-owned images and AI generation', () => {
    expect(portraitPickerSource).toContain('本地图片');
    expect(portraitPickerSource).toContain('AI 生成');
    expect(portraitPickerSource).not.toContain('listPresetPortraits');
    expect(portraitPickerSource).not.toContain('默认立绘');
    expect(portraitPickerSource).not.toContain('默认图库');
    expect(portraitUtilsSource).not.toContain('PRESET_PORTRAITS');
    expect(portraitUtilsSource).not.toContain('UserPresetPortrait');
  });
});

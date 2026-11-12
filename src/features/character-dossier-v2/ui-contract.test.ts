/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
  normalizeCharacterCardAppearanceId,
} from '../../constants/character-card-appearances';

const dossierSource = readFileSync(
  fileURLToPath(new URL('./CharacterDossierBook.tsx', import.meta.url)),
  'utf8',
);
const modalSource = readFileSync(
  fileURLToPath(
    new URL('../../components/novel-create/NovelCastCharacterModal.tsx', import.meta.url),
  ),
  'utf8',
);
const biographySource = readFileSync(
  fileURLToPath(new URL('./CharacterBiographyPage.tsx', import.meta.url)),
  'utf8',
);
const generationPromptSource = readFileSync(
  fileURLToPath(new URL('./generation-prompt.ts', import.meta.url)),
  'utf8',
);
const dossierTypeSource = readFileSync(
  fileURLToPath(
    new URL('../../types/character-dossier-v2.ts', import.meta.url),
  ),
  'utf8',
);
const settingsSource = readFileSync(
  fileURLToPath(new URL('../../app/(tabs)/novel-settings.tsx', import.meta.url)),
  'utf8',
);
const knowledgeSource = readFileSync(
  fileURLToPath(
    new URL('../../app/novel/knowledge/characters/[novelId].tsx', import.meta.url),
  ),
  'utf8',
);
const appearancePickerSource = readFileSync(
  fileURLToPath(new URL('../../components/CharacterCardAppearancePicker.tsx', import.meta.url)),
  'utf8',
);
const appearanceSource = readFileSync(
  fileURLToPath(new URL('../../constants/character-card-appearances.ts', import.meta.url)),
  'utf8',
);

describe('character dossier v2 UI contract', () => {
  it('renders body fat, measurements and shoe size as real public fields', () => {
    expect(dossierSource).toContain('label="体脂率"');
    expect(dossierSource).toContain('label="三围"');
    expect(dossierSource).toContain('label="鞋码"');
  });

  it('edits retrieval aliases as part of the public dossier', () => {
    expect(dossierSource).toContain('label="其他称呼 / 触发词"');
    expect(dossierSource).toMatch(/onDraftChange\(\s*'aliases'/);
  });

  it('does not replace the entire knowledge body when NSFW is enabled', () => {
    expect(modalSource).not.toMatch(
      /\{nsfwEnabled \? \(\s*<GestureHandlerRootView[\s\S]*?\) : \(\s*<GHScrollView/,
    );
  });

  it('uses gender data to choose the private-card variant without large card toggles', () => {
    expect(dossierSource).toContain('resolveCharacterDossierVariant(draft.gender)');
    expect(dossierSource).not.toContain("variant === 'male' ? '男性卡' : '女性卡'");
  });

  it('keeps the portrait beneath the dossier fields without reserving a separate image column', () => {
    expect(dossierSource).toContain("flexBasis: '48%'");
    expect(dossierSource).toContain("flexBasis: 'auto'");
    expect(dossierSource).toContain('const compact = width < 920');
    expect(dossierSource).toContain('styles.portraitPageFigure');
    expect(dossierSource).toContain('contentFit="contain"');
    expect(dossierSource).not.toContain('styles.compactPortraitStage');
    expect(dossierSource).not.toContain('styles.desktopPortraitStage');
  });

  it('opens portraits in an immersive viewer with zoom and explicit or long-press saving', () => {
    expect(dossierSource).toContain('<ImmersivePortraitViewer');
    expect(dossierSource).toContain('Gesture.Pinch()');
    expect(dossierSource).toContain('Gesture.LongPress()');
    expect(dossierSource).toContain('saveImageToDevice(image.uri)');
    expect(dossierSource).toContain('保存原图');
    expect(dossierSource).not.toContain('styles.previewStage');
  });

  it('removes the boundaries and aftercare field from UI, types and generation JSON', () => {
    expect(dossierSource).not.toContain('边界与事后');
    expect(dossierSource).not.toContain("updatePrivate('boundaries'");
    expect(dossierTypeSource).not.toContain('boundaries: string');
    expect(generationPromptSource).not.toContain('"boundaries"');
  });

  it('uses an unbounded add-only biography page without empty placeholders', () => {
    expect(dossierSource).toContain("'public' | 'private' | 'biography'");
    expect(dossierSource).toContain('<CharacterBiographyPage');
    expect(biographySource).toContain('添加第一篇小传');
    expect(biographySource).toContain('visibleEntries.map((entry, index)');
    expect(biographySource).toContain('BIOGRAPHY_PAGE_SIZE = 12');
    expect(biographySource).not.toContain('[1, 2, 3, 4]');
    expect(modalSource).toContain(": 'biography'");
    expect(modalSource).toContain('loadCharacterBiographies');
    expect(modalSource).toContain('saveCharacterBiographies');
  });

  it('shows non-destructive consistency diagnostics before saving', () => {
    expect(modalSource).toContain('CONSISTENCY SCAN');
    expect(modalSource).toContain('仅提示，不会自动覆盖你的设定。');
  });

  it('keeps page-navigation buttons on web and removes them from the native header', () => {
    expect(modalSource).toContain("const showPageNavigationButtons = Platform.OS === 'web'");
    expect(modalSource).toContain('{showPageNavigationButtons ? (');
    expect(modalSource).toContain("caption: 'PRIVATE', enabled: true");
    expect(modalSource).toContain("caption: 'BIO', enabled: true");
  });

  it('removes custom character-card skin management from novel settings', () => {
    expect(settingsSource).not.toContain('CharacterCardSkinEditor');
    expect(settingsSource).not.toContain('人设卡皮肤');
  });

  it('offers only the two newly authored premium card treatments', () => {
    const appearances = appearanceSource.match(
      /export const CHARACTER_CARD_APPEARANCES:[\s\S]*?= \[([\s\S]*?)\];/,
    )?.[1] ?? '';
    expect(appearances.match(/id:/g)).toHaveLength(2);
    expect(appearances).toContain("id: 'character-card-collection'");
    expect(appearances).toContain("id: 'character-card-nocturne'");
    expect(appearanceSource).not.toContain('content:');
    expect(modalSource).toContain('appearanceId={resolvedAppearance.id}');
  });

  it('rejects unsupported appearance ids instead of migrating old skins', () => {
    expect(normalizeCharacterCardAppearanceId('character-card-dossier')).toBe(
      DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
    );
    expect(normalizeCharacterCardAppearanceId('custom-deleted-skin')).toBe(
      DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
    );
  });

  it('removes the legacy HTML-card implementation files', () => {
    const removedFiles = [
      '../../components/CharacterCardHtmlEditor.tsx',
      '../../components/CharacterCardHtmlPreview.tsx',
      '../../utils/character-card-html.ts',
      '../../constants/character-card-privacy-skins.ts',
      '../../constants/character-card-skins.ts',
    ];
    expect(removedFiles.every((path) => !existsSync(fileURLToPath(new URL(path, import.meta.url))))).toBe(true);
  });

  it('keeps the high-impact archive choreography in the live UI', () => {
    expect(dossierSource).toContain('const contentMotion = useMemo');
    expect(dossierSource).toContain('styles.pageWatermark');
    expect(dossierSource).toContain('styles.orbit');
    expect(knowledgeSource).toContain('styles.archiveHeroNumber');
    expect(knowledgeSource).toContain('styles.cardInnerBezel');
    expect(appearancePickerSource).toContain('Animated.spring(entrance');
    expect(appearancePickerSource).toContain('styles.previewComposition');
    expect(modalSource).toContain('styles.commandShell');
    expect(modalSource).toContain('styles.stageShell');
    expect(modalSource).toContain('styles.saveDockShell');
  });
});

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const themeSource = read('../../constants/theme.ts');
const rootLayoutSource = read('../../app/_layout.tsx');
const tabLayoutSource = read('../../app/(tabs)/_layout.tsx');
const backdropSource = read('../ThemeBackdrop.tsx');
const openingSource = read('../app-opening-sequence.tsx');
const novelsSource = read('../../app/(tabs)/novels.tsx');
const novelSettingsSource = read('../../app/(tabs)/novel-settings.tsx');
const novelPromptDefaultsSource = read('../novel-settings/NovelPromptDefaultsPanel.tsx');
const systemSettingsSource = read('../../app/explore.tsx');
const debugSource = read('../../app/debug.tsx');
const storeSource = read('../../store/tavern-store.ts');
const knowledgeSource = read('../../app/novel/knowledge/[novelId].tsx');
const outlineSource = read('../../app/novel/world-outline/[novelId].tsx');
const dossierBookSource = read('../../features/character-dossier-v2/CharacterDossierBook.tsx');

describe('application visual system contract', () => {
  it('uses the bundled editorial font pair across native and web', () => {
    expect(themeSource).toContain("sans: 'NotoSansSC'");
    expect(themeSource).toContain("serif: 'NotoSerifSC'");
    expect(rootLayoutSource).toContain('fontFamily: Fonts.sans');
  });

  it('keeps navigation expressive and platform-safe', () => {
    expect(tabLayoutSource).toContain('SymbolView');
    expect(tabLayoutSource).toContain('tabBarActiveBackgroundColor');
    expect(tabLayoutSource).toContain("tabBarHideOnKeyboard: true");
    expect(tabLayoutSource).toContain('useSafeAreaInsets');
    expect(tabLayoutSource).not.toContain("position: 'absolute'");
    expect(rootLayoutSource).toContain("animation: motionEnabled ? 'fade_from_bottom' : 'none'");
  });

  it('gives the home tab a focused mobile shelf while inner tools keep the editorial masthead', () => {
    expect(novelsSource).toContain('<NovelMobileShelf');
    expect(novelsSource).toContain('onCreate={handleCreateNovel}');
    expect(novelsSource).toContain('onImport={() => void handleImportNovel()}');
    expect(novelSettingsSource).toContain('<AppPageHeader');
    expect(systemSettingsSource).toContain('<AppPageHeader');
  });

  it('keeps the mobile shelf inside the safe area on phones', () => {
    expect(novelsSource).toContain("edges={['top', 'left', 'right']}");
    expect(novelsSource).not.toContain('deckStage');
    expect(novelsSource).toContain('NovelMobileShelf');
  });

  it('keeps novel settings focused on active writing controls', () => {
    expect(novelSettingsSource).toContain('<NovelWritingExtensionPanel kind="jailbreak"');
    expect(novelSettingsSource).toContain('<NovelWritingExtensionPanel kind="mod"');
    expect(novelSettingsSource).toContain('<NovelPromptDefaultsPanel');
    expect(novelSettingsSource).not.toContain('NovelCastLimitPanel');
    expect(novelSettingsSource).not.toContain('NovelPortraitPresetsPanel');
    expect(novelPromptDefaultsSource).toContain('sectionNumber="03"');
  });

  it('uses the live request archive as the entire debug surface', () => {
    expect(debugSource).toContain('LIVE REQUEST ARCHIVE');
    expect(debugSource).toContain('styles.consoleDeck');
    expect(debugSource).not.toContain('<AppPageHeader');
    expect(debugSource).not.toContain('TelemetryMetric');
    expect(debugSource).not.toContain('styles.telemetryGrid');
    expect(debugSource).not.toContain('<ThemeBackdrop');
  });

  it('retains atmospheric structure without putting it in the interaction layer', () => {
    expect(backdropSource).toContain('pointerEvents="none"');
    expect(backdropSource).toContain('styles.orbitOuter');
    expect(backdropSource).toContain('styles.axisHorizontal');
  });

  it('keeps the observatory as the single visual system', () => {
    expect(themeSource).not.toContain('ThemePreset');
    expect(storeSource).not.toContain('themePreset');
    expect(novelsSource).not.toContain('DaylightEditorialShelf');
    expect(openingSource).not.toContain('DaylightOpeningSequence');
    expect(backdropSource).not.toContain('daylight');
    expect(systemSettingsSource).toContain('叙事观测仪的明暗模式与界面动画');
    expect(systemSettingsSource).toContain('label="界面动画"');
    expect(rootLayoutSource).toContain('<AnimatedSplashOverlay enabled={motionEnabled}');
    expect(openingSource).toContain('claimAppOpeningSequence');
    expect(openingSource).toContain('forcePreview || claimAppOpeningSequence');
    expect(systemSettingsSource).toContain('预览当前主题动画');
  });

  it('uses one global motion preference for navigation and decorative page reveals', () => {
    expect(knowledgeSource).toContain('state.appearanceSettings.motionEnabled');
    expect(outlineSource).toContain('state.appearanceSettings.motionEnabled');
    expect(dossierBookSource).toContain('state.appearanceSettings.motionEnabled');
    expect(dossierBookSource).toContain('if (!motionEnabled)');
  });
});

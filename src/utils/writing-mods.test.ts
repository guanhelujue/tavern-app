import { describe, expect, it } from 'vitest';
import { DEFAULT_MOD_EXTRACTION_PROMPT, LEGACY_MOD_EXTRACTION_PROMPT, REPORT_MOD_EXTRACTION_PROMPT } from '../constants/writing-mod';
import { buildWritingPromptExtensionBlocks, normalizeWritingPromptExtensions } from './writing-prompt-extensions';
import { normalizeWritingModSettings, prepareWritingModSamples } from './writing-mods';

describe('named writing MODs', () => {
  it('preserves legacy content and enabled state across migration and reload', () => {
    const old = { modEnabled: true, modPrompt: '  原有规则\n' };
    const migrated = { ...old, ...normalizeWritingModSettings(old) };
    const restored = JSON.parse(JSON.stringify(migrated));
    expect(restored.modLibrary).toEqual([{ id: 'legacy-mod', name: '我的 MOD（原有内容）', content: old.modPrompt, enabled: true }]);
    expect(normalizeWritingModSettings(restored)).toEqual(normalizeWritingModSettings(old));
    expect(buildWritingPromptExtensionBlocks(restored)).toEqual(['【MOD】\n原有规则']);
  });

  it('migrates the legacy selection without injecting the extraction prompt or legacy cache', () => {
    const settings = {
      modEnabled: true, modPrompt: 'STALE_LEGACY', selectedModId: 'b', modExtractionPrompt: 'EXTRACTION_ONLY',
      modLibrary: [{ id: 'a', name: '第一份', content: 'FIRST' }, { id: 'b', name: '第二份', content: 'SECOND' }],
    };
    expect(buildWritingPromptExtensionBlocks(settings)).toEqual(['【MOD】\nSECOND']);
    expect(normalizeWritingPromptExtensions(settings).modPrompt).toBe('SECOND');
    expect(buildWritingPromptExtensionBlocks({ ...settings, selectedModId: 'a' })).toEqual(['【MOD】\nFIRST']);
    expect(buildWritingPromptExtensionBlocks({ ...settings, modEnabled: false })).toEqual([]);
    expect(buildWritingPromptExtensionBlocks({ ...settings, selectedModId: 'missing' })).toEqual([]);
  });

  it('injects every enabled MOD in library order regardless of stale legacy switch/selection', () => {
    const settings = {
      modEnabled: false, selectedModId: 'c', modPrompt: 'STALE', modExtractionPrompt: 'EXTRACTION_ONLY',
      modLibrary: [
        { id: 'a', name: '第一份', content: 'FIRST', enabled: true },
        { id: 'b', name: '第二份', content: 'SECOND', enabled: true },
        { id: 'c', name: '关闭项', content: 'DISABLED', enabled: false },
      ],
    };
    const restored = JSON.parse(JSON.stringify({ ...settings, ...normalizeWritingModSettings(settings) }));
    expect(buildWritingPromptExtensionBlocks(restored)).toEqual(['【MOD】\n【第一份】\nFIRST\n\n【第二份】\nSECOND']);
    expect(normalizeWritingPromptExtensions(restored).modEnabled).toBe(true);
    const disabled = { ...restored, modLibrary: restored.modLibrary.map((mod: { id: string; enabled: boolean }) =>
      mod.id === 'a' ? { ...mod, enabled: false } : mod) };
    expect(buildWritingPromptExtensionBlocks(disabled)).toEqual(['【MOD】\nSECOND']);
    expect(buildWritingPromptExtensionBlocks({ ...restored, modLibrary: settings.modLibrary.filter((mod) => mod.id !== 'a') }))
      .toEqual(['【MOD】\nSECOND']);
  });

  it('does not reactivate explicitly disabled or deleted MODs after reload', () => {
    const settings = { modEnabled: true, selectedModId: 'a', modPrompt: 'OLD',
      modLibrary: [{ id: 'a', name: 'A', content: 'TEXT', enabled: false }] };
    const normalized = { ...settings, ...normalizeWritingModSettings(settings) };
    expect(buildWritingPromptExtensionBlocks(JSON.parse(JSON.stringify(normalized)))).toEqual([]);
    expect(buildWritingPromptExtensionBlocks({ ...normalized, modLibrary: [] })).toEqual([]);
  });

  it('migrates only the old active selection and defaults new libraries to disabled', () => {
    const library = [{ id: 'a', name: 'A', content: 'A' }, { id: 'b', name: 'B', content: 'B' }];
    expect(normalizeWritingModSettings({ modLibrary: library, modEnabled: true, selectedModId: 'b' }).modLibrary.map((mod) => mod.enabled))
      .toEqual([false, true]);
    expect(normalizeWritingModSettings({ modLibrary: library }).modLibrary.map((mod) => mod.enabled)).toEqual([false, false]);
  });

  it('does not resurrect deleted content or an explicitly cleared selection', () => {
    expect(normalizeWritingModSettings({ modLibrary: [], modPrompt: 'OLD' }).modLibrary).toEqual([]);
    expect(buildWritingPromptExtensionBlocks({ modEnabled: true, modLibrary: [], modPrompt: 'OLD' })).toEqual([]);
    const cleared = { modLibrary: [{ id: 'a', name: 'A', content: 'TEXT' }], selectedModId: '', modEnabled: true };
    expect(buildWritingPromptExtensionBlocks(JSON.parse(JSON.stringify(cleared)))).toEqual([]);
  });

  it('keeps customized extraction instructions across a JSON round trip', () => {
    const settings = normalizeWritingModSettings({ modExtractionPrompt: '  自定义\n' });
    expect(normalizeWritingModSettings(JSON.parse(JSON.stringify(settings))).modExtractionPrompt).toBe('  自定义\n');
    expect(normalizeWritingModSettings().modExtractionPrompt).toBe(DEFAULT_MOD_EXTRACTION_PROMPT);
  });

  it.each([LEGACY_MOD_EXTRACTION_PROMPT, REPORT_MOD_EXTRACTION_PROMPT])('upgrades a saved default without overwriting user edits', (previousDefault) => {
    expect(normalizeWritingModSettings({ modExtractionPrompt: previousDefault }).modExtractionPrompt)
      .toBe(DEFAULT_MOD_EXTRACTION_PROMPT);
    expect(normalizeWritingModSettings({ modExtractionPrompt: previousDefault.replace(/\n/g, '\r\n') }).modExtractionPrompt)
      .toBe(DEFAULT_MOD_EXTRACTION_PROMPT);
    const custom = `${previousDefault}\n自定义要求`;
    expect(normalizeWritingModSettings({ modExtractionPrompt: custom }).modExtractionPrompt).toBe(custom);
  });

  it('upgrades extraction instructions without rewriting existing MODs or their switches', () => {
    const modLibrary = [{ id: 'saved', name: '已有 MOD', content: '【文风特征与证据】\n既有内容', enabled: true }];
    const settings = normalizeWritingModSettings({ modLibrary, modExtractionPrompt: REPORT_MOD_EXTRACTION_PROMPT });
    expect(settings.modLibrary).toEqual(modLibrary);
    expect(settings.modExtractionPrompt).toBe(DEFAULT_MOD_EXTRACTION_PROMPT);
  });

  it('requests a standalone execution skill with internal evidence checks, not a report', () => {
    expect(DEFAULT_MOD_EXTRACTION_PROMPT).toContain('执行者不会看到原文');
    expect(DEFAULT_MOD_EXTRACTION_PROMPT).toContain('证据用于内部核验');
    expect(DEFAULT_MOD_EXTRACTION_PROMPT).toContain('【核心写法】');
    expect(DEFAULT_MOD_EXTRACTION_PROMPT).toContain('【场景调度】');
    expect(DEFAULT_MOD_EXTRACTION_PROMPT).not.toContain('【文风特征与证据】');
    expect(DEFAULT_MOD_EXTRACTION_PROMPT).not.toContain('【观察范围】');
  });

  it('preserves every character of long articles and pasted text without a shared budget', () => {
    const first = `\n第一章\r\n${'连续原文'.repeat(235000)}\n终章\n`;
    const second = `  另一篇文章\n${'另一段原文'.repeat(30000)}\r\n `;
    const result = prepareWritingModSamples([{ name: '长篇.txt', text: first }, { name: '粘贴文章', text: second }]);
    expect(result).toBe(`【文章 1：长篇.txt】\n${first}\n\n【文章 2：粘贴文章】\n${second}`);
    expect(prepareWritingModSamples([{ name: '空', text: ' ' }])).toBe('');
  });
});

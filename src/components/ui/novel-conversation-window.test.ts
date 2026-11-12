/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const novelScreenSource = read('../../app/novel/[novelId].tsx');
const chapterWorkspaceSource = read('../desktop/DesktopChapterWorkspace.tsx');
const storyMemorySource = read('../NovelStoryMemoryModal.tsx');
const chatSettingsMenuSource = read('../ChatSettingsMenu.tsx');
const actionMenuSource = read('../NovelActionMenuModal.tsx');
const settingsSource = read('../../app/explore.tsx');
const storeSource = read('../../store/tavern-store.ts');
const backdropSource = read('../ThemeBackdrop.tsx');

describe('novel conversation rendering contract', () => {
  it('routes legacy novel links into the unified chapter workspace', () => {
    expect(novelScreenSource).toContain("return <Redirect href={novelId ? `/novel/workbench/${novelId}` : '/(tabs)/novels'} />");
    expect(novelScreenSource).not.toContain('NovelPagedMarkdown');
    expect(novelScreenSource).not.toContain('paginateNovelText');
    expect(chapterWorkspaceSource).toContain('DesktopChapterWorkspace');
    expect(chapterWorkspaceSource).toContain('NovelMobileChapterHome');
  });

  it('hydrates chapter bodies on selection and protects unsaved edits', () => {
    expect(chapterWorkspaceSource).toContain('hydrateChapter(selectedId)');
    expect(chapterWorkspaceSource).toContain('usePreventRemove(dirty');
    expect(chapterWorkspaceSource).toContain('beforeunload');
  });

  it('does not replay the memory modal entrance when an injection switch changes', () => {
    const entranceEffect = storyMemorySource.match(
      /useEffect\(\(\) => \{[\s\S]*?Animated\.spring\(reveal,[\s\S]*?\}, \[([^\]]+)\]\);/,
    );
    expect(entranceEffect?.[1]).toBeDefined();
    expect(entranceEffect?.[1]).not.toContain('injectionToggles');
    expect(entranceEffect?.[1]).not.toContain('longTermMemory');
    expect(entranceEffect?.[1]).not.toContain('midTermMemories');
    expect(entranceEffect?.[1]).not.toContain('shortTermMemories');
  });

  it('uses a full-width compact header and a bounded scrolling body on phones', () => {
    expect(storyMemorySource).toContain('styles.headerCopyCompact');
    expect(storyMemorySource).toContain('styles.titleCompact');
    expect(storyMemorySource).toContain('styles.headerTelemetryCompact');
    expect(storyMemorySource).toContain('styles.scrollCompact');
    expect(storyMemorySource).toContain('styles.secondaryButtonCompact');
  });

  it('does not use the novel cover as an implicit conversation background', () => {
    expect(novelScreenSource).toContain('Redirect');
    expect(novelScreenSource).not.toContain('novel?.chatBackgroundUri || novel?.coverImageUri');
  });

  it('groups secondary composer and archive actions behind compact entries', () => {
    expect(chatSettingsMenuSource).toContain("key: 'archiveActions'");
    expect(chatSettingsMenuSource).toContain("key: 'editNovel'");
    expect(chatSettingsMenuSource).not.toContain("key: 'exportNovel'");
    expect(chatSettingsMenuSource).not.toContain("key: 'deleteNovel'");
    expect(actionMenuSource).toContain('items.map((item, index)');
  });
});

describe('observatory backdrop contract', () => {
  it('uses a fixed structural backdrop without image or intensity controls', () => {
    expect(backdropSource).not.toContain("from 'expo-image'");
    expect(backdropSource).not.toContain('theme-backgrounds');
    expect(settingsSource).not.toContain('主题氛围强度');
    expect(settingsSource).not.toContain('themeBackdropVisibility');
    expect(storeSource).not.toContain('themeBackdropVisibility');
  });
});

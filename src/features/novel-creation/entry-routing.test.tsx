import { describe, expect, it, vi } from 'vitest';
import CreateRoute from '@/app/novel/create';
import OldContinueRoute from '@/app/novel/continue';
import OldInteractiveRoute from '@/app/novel/interactive/create';
import OldNovelRoute from '@/app/novel/[novelId]';

const fixture = vi.hoisted(() => ({ params: {} as { draftId?: string; novelId?: string } }));
vi.mock('expo-router', () => ({ Redirect: 'redirect', useLocalSearchParams: () => fixture.params }));
vi.mock('./CreateNovelScreen', () => ({ default: 'current-creation-screen' }));

describe('unified novel entry', () => {
  it('retains the current creation screen instead of creating a blank book automatically', () => {
    fixture.params = {};
    expect(CreateRoute().type).toBe('current-creation-screen');
    expect(OldContinueRoute).toBe(CreateRoute);
    expect(OldInteractiveRoute).toBe(CreateRoute);
  });

  it('opens saved shelf drafts and old book links in the same workspace', () => {
    fixture.params = { draftId: 'old-draft' };
    expect(CreateRoute().props.href).toBe('/novel/workbench/old-draft');
    fixture.params = { novelId: 'old-interactive-book' };
    expect(OldNovelRoute().props.href).toBe('/novel/workbench/old-interactive-book');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import NovelWorkbenchScreen from '@/app/novel/workbench/[novelId]';

const fixture = vi.hoisted(() => ({ platform: 'web', params: { novelId: 'book', focus: '', autoAnalyze: '' } }));
vi.mock('expo-router', () => ({ Redirect: 'redirect', useLocalSearchParams: () => fixture.params }));
vi.mock('react-native', () => ({ Platform: { get OS() { return fixture.platform; } }, StyleSheet: { create: (styles: unknown) => styles } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'safe-area' }));
vi.mock('@/components/novel-continue/NovelWorkbench', () => ({ NovelWorkbench: 'workbench' }));

describe('legacy workbench links', () => {
  beforeEach(() => { fixture.platform = 'web'; fixture.params = { novelId: 'book', focus: '', autoAnalyze: '' }; });

  it.each(['android', 'ios', 'web'])('opens the same chapter workspace on %s', (platform) => {
    fixture.platform = platform;
    expect(NovelWorkbenchScreen()?.props.href).toBe('/novel/chapters/book');
    fixture.params.focus = 'tools';
    expect(NovelWorkbenchScreen()?.props.children.props.initialTab).toBe('tools');
  });

  it.each([
    ['settings', '/novel/edit/book'],
    ['consistency', '/novel/chapters/book'],
    ['forecast', '/novel/world-outline/book'],
  ])('redirects the old web %s page to its writing destination', (focus, href) => {
    fixture.params.focus = focus;
    expect(NovelWorkbenchScreen()?.props.href).toBe(href);
  });

  it('opens context management and preserves imported-novel auto analysis', () => {
    fixture.params.focus = 'context';
    expect(NovelWorkbenchScreen()?.props.children.props.initialTab).toBe('context');
    fixture.params.focus = 'analysis';
    fixture.params.autoAnalyze = '1';
    const workbench = NovelWorkbenchScreen()?.props.children;
    expect(workbench.props.initialTab).toBe('analysis');
    expect(workbench.props.autoAnalyze).toBe(true);
  });

  it.each(['settings', 'consistency', 'forecast'])('preserves the native %s page', (focus) => {
    fixture.platform = 'android'; fixture.params.focus = focus;
    expect(NovelWorkbenchScreen()?.props.children.props.initialTab).toBe(focus);
  });
});

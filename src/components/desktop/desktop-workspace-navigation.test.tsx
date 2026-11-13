import React from 'react';
// @ts-expect-error This repo intentionally does not install @types/react-dom for Vitest-only SSR markup tests.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';
import { DesktopAppShell } from './DesktopAppShell.web';
import { DesktopNovelShelf } from './DesktopNovelShelf';

const rnState = vi.hoisted(() => ({
  platform: 'web' as string,
  width: 800,
}));
const routerState = vi.hoisted(() => ({ pathname: '/novel/chapters/novel-1', params: { novelId: 'novel-1' } }));
const interactionState = vi.hoisted(() => ({ handlers: new Map<string, () => void>(), links: new Set<string>() }));

vi.mock('react-native', () => ({
  Keyboard: { metrics: () => undefined, addListener: () => ({ remove: () => {} }) },
  Platform: { get OS() { return rnState.platform; }, select: (values: Record<string, unknown>) => values[rnState.platform] ?? values.default },
  useWindowDimensions: () => ({ width: rnState.width, height: 800, scale: 1, fontScale: 1 }),
  Pressable: ({ children, accessibilityLabel, onPress, ..._props }: any) => {
    if (accessibilityLabel && onPress) interactionState.handlers.set(accessibilityLabel, onPress);
    return <button aria-label={accessibilityLabel}>{children}</button>;
  },
  ScrollView: ({ children, ..._props }: any) => <div>{children}</div>,
  StyleSheet: {
    create: (value: unknown) => value,
    flatten: (value: unknown) => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean)) : value,
  },
  View: ({ children, role, ..._props }: any) => <div role={role}>{children}</div>,
  Text: ({ children, ..._props }: any) => <span>{children}</span>,
  TextInput: ({ placeholder, value, onChangeText, ..._props }: any) => <input placeholder={placeholder} value={value} onChange={() => onChangeText?.('')} />,
}));

vi.mock('expo-router', () => ({
  Link: ({ children, href }: any) => { if (href) interactionState.links.add(String(href)); return children; },
  usePathname: () => routerState.pathname,
  useGlobalSearchParams: () => routerState.params,
}));

vi.mock('expo-image', () => ({ Image: ({ accessibilityLabel }: { accessibilityLabel?: string }) => <img alt={accessibilityLabel} /> }));

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ background: '#fff', surface: '#fff', surfaceElevated: '#fff', surfaceVariant: '#eee', outlineVariant: '#ddd', primary: '#000', primaryContainer: '#eee', onPrimary: '#fff', text: '#000', textSecondary: '#555' }),
}));

vi.mock('@/store/tavern-store', () => ({
  useTavernStore: (selector: (state: unknown) => unknown) => selector({ novels: [{ id: 'novel-1', name: '测试作品' }] }),
}));
vi.mock('@/utils/novel-images', () => ({ resolveNovelImageUri: () => undefined }));

function LayoutProbe() {
  return <span>{useDesktopLayout() ? 'desktop' : 'mobile'}</span>;
}

describe('novel workspace desktop boundaries', () => {
  beforeEach(() => {
    rnState.platform = 'web';
    rnState.width = 800;
    routerState.pathname = '/novel/chapters/novel-1';
    interactionState.handlers.clear();
    interactionState.links.clear();
  });

  it('uses web platform rather than viewport width to select the desktop shell', () => {
    expect(renderToStaticMarkup(<LayoutProbe />)).toContain('desktop');
    rnState.platform = 'android';
    rnState.width = 1400;
    expect(renderToStaticMarkup(<LayoutProbe />)).toContain('mobile');
    rnState.platform = 'ios';
    expect(renderToStaticMarkup(<LayoutProbe />)).toContain('mobile');
  });

  it('keeps project navigation focused on writing assets and context management', () => {
    rnState.width = 1200;
    const html = renderToStaticMarkup(<DesktopAppShell><span>content</span></DesktopAppShell>);
    expect(html).toContain('上下文管理');
    expect(html).not.toContain('状态分析');
    expect(html).not.toContain('路线推演');
    expect(html).not.toContain('一致性检查');
    expect(html).not.toContain('写作设置');
    expect(interactionState.links).toContain('/novel/workbench/novel-1?focus=context');
  });

  it('exposes a delete action for every work on the shelf', () => {
    const onDelete = vi.fn();
    const onOpen = vi.fn();
    const html = renderToStaticMarkup(<DesktopNovelShelf
      novels={[{ id: 'novel-1', name: '测试作品', updatedAt: new Date().toISOString(), isDraft: false } as any, { id: 'novel-2', name: '第二部', updatedAt: new Date().toISOString(), isDraft: false } as any]}
      onOpen={onOpen}
      onCreate={vi.fn()}
      onImport={vi.fn()}
      onDelete={onDelete}
    />);
    expect(html).toContain('删除作品 测试作品');
    expect(html).toContain('删除作品 第二部');
    expect(html).toContain('打开作品 测试作品');
    expect(html).toContain('打开作品 第二部');
    expect(html).toContain('创建作品');
    expect(html).not.toContain('接入续写');
    interactionState.handlers.get('删除作品 测试作品')?.();
    expect(onDelete).toHaveBeenCalledWith('novel-1');
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

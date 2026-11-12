import { describe, expect, it, vi } from 'vitest';
import { CHAT_IMPORT_LIMITS } from './chat-session-schema';
import { serializeChatSessionBundleForExport } from './chat-session-io';


vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-file-system/legacy', () => ({}));
vi.mock('expo-sharing', () => ({}));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));


function baseBundle() {
  return {
    version: 5 as const,
    kind: 'novel' as const,
    sessionId: 'novel-1',
    exportedAt: '2026-09-20T00:00:00.000Z',
    title: '测试小说',
    config: { contextLength: 8192, mainPrompt: '', prefix: '', suffix: '', worldbookEntries: [], backgroundEnabled: true, bubbleOpacity: 1, memory: '' },
    messages: [],
  };
}

describe('chat session export serialization', () => {
  it('returns JSON that can be parsed back', () => {
    const serialized = serializeChatSessionBundleForExport(baseBundle());
    expect(JSON.parse(serialized)).toMatchObject({ sessionId: 'novel-1', version: 5 });
  });

  it('rejects a complete backup whose UTF-8 output exceeds the import limit', () => {
    const bundle = { ...baseBundle(), novel: {
      id: 'novel-1', name: '测试小说', createdAt: baseBundle().exportedAt, updatedAt: baseBundle().exportedAt,
      oversizedUnknownField: 'x'.repeat(CHAT_IMPORT_LIMITS.maxBytes),
    } } as any;
    expect(() => serializeChatSessionBundleForExport(bundle)).toThrow('超过大小限制');
  });
});

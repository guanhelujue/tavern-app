import { describe, expect, it } from 'vitest';

import { parseChatSessionExportBundle } from './chat-session-schema';

function bundle() {
  return {
    version: 4,
    kind: 'novel',
    sessionId: 'novel-1',
    exportedAt: '2026-09-20T00:00:00.000Z',
    title: '测试小说',
    config: {
      contextLength: 8192,
      mainPrompt: '',
      prefix: '',
      suffix: '',
      worldbookEntries: [],
      backgroundEnabled: false,
      bubbleOpacity: 1,
      memory: '',
    },
    messages: [],
    novel: {
      id: 'novel-1',
      name: '测试小说',
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z',
    },
    characterBiographies: {
      'char-1': [{
        id: 'bio-1',
        title: '旧信',
        request: '写一封没有寄出的信',
        content: '他把信折好，却没有写收件人的名字。',
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
      }],
    },
  };
}

describe('chat session backup schema v4', () => {
  it('restores separately stored character biographies', () => {
    const parsed = parseChatSessionExportBundle(bundle());
    expect(parsed.version).toBe(4);
    expect(parsed.characterBiographies?.['char-1']?.[0]?.title).toBe('旧信');
  });

  it('rejects biography entries without readable content', () => {
    const raw = bundle();
    raw.characterBiographies['char-1'][0]!.content = '';
    expect(() => parseChatSessionExportBundle(raw)).toThrow('biography.content');
  });
});

describe('chat session backup schema v5', () => {
  it('restores cancelled messages, world sessions, full metadata and empty slots', () => {
    const raw = bundle() as any;
    raw.version = 5;
    raw.messages = [{
      id: 'main-1', characterId: 'char-1', worldId: 'world-a', role: 'assistant',
      content: '<statusbar>keep</statusbar>', status: 'cancelled',
      createdAt: raw.exportedAt, updatedAt: raw.exportedAt,
    }];
    raw.config.currentChapter = '第 1 章';
    raw.worldSessions = {
      'world-a': {
        messages: raw.messages,
        meta: {
          id: 'session-a', novelId: 'novel-1', title: '世界 A', memory: 'world memory', longTermMemory: 'long',
          midTermMemories: ['mid'], shortTermMemories: ['short'], lastMessageAt: raw.exportedAt,
          createdAt: raw.exportedAt, updatedAt: raw.exportedAt, contextLength: 8192, mainPrompt: 'prompt',
          prefix: 'prefix', suffix: 'suffix', worldbookEntries: [], backgroundEnabled: false, bubbleOpacity: 1,
          activeRequestId: 'runtime', requestStatus: 'streaming', agentStage: 'writing',
        },
        slotBook: {
          activeSlotId: 'slot-a',
          slots: [{ id: 'slot-a', name: 'A', createdAt: raw.exportedAt, updatedAt: raw.exportedAt,
            messages: [], memory: 'slot memory', longTermMemory: 'slot long', midTermMemories: [], shortTermMemories: [],
            lastMessageAt: raw.exportedAt, title: '世界 A', contextLength: 8192, mainPrompt: 'prompt', prefix: 'prefix',
            suffix: 'suffix', worldbookEntries: [], backgroundEnabled: false, bubbleOpacity: 1 }],
          previousSnapshot: null,
        },
      },
    };
    const parsed = parseChatSessionExportBundle(raw);
    expect(parsed.version).toBe(5);
    expect(parsed.messages[0]?.status).toBe('cancelled');
    expect(parsed.worldSessions?.['world-a']?.meta.currentChapter).toBeUndefined();
    expect(parsed.worldSessions?.['world-a']?.meta.requestStatus).toBeUndefined();
    expect(parsed.worldSessions?.['world-a']?.meta.memory).toBe('world memory');
    expect(parsed.worldSessions?.['world-a']?.slotBook?.slots).toHaveLength(1);
  });

  it('rejects duplicate message ids within one world', () => {
    const raw = bundle() as any;
    raw.version = 5;
    raw.worldSessions = {
      'world-a': {
        messages: [
          { id: 'same', role: 'user', content: 'a', status: 'complete', createdAt: raw.exportedAt, updatedAt: raw.exportedAt },
          { id: 'same', role: 'user', content: 'b', status: 'complete', createdAt: raw.exportedAt, updatedAt: raw.exportedAt },
        ],
        meta: {
          id: 'session-a', novelId: 'novel-1', title: 'A', memory: '', longTermMemory: '',
          midTermMemories: [], shortTermMemories: [], lastMessageAt: raw.exportedAt,
          createdAt: raw.exportedAt, updatedAt: raw.exportedAt, contextLength: 8192, mainPrompt: '', prefix: '',
          suffix: '', worldbookEntries: [], backgroundEnabled: false, bubbleOpacity: 1,
        },
      },
    };
    expect(() => parseChatSessionExportBundle(raw)).toThrow('消息 ID 重复');
  });

  it('rejects malformed or duplicate slot metadata but permits shared snapshot message ids', () => {
    const raw = bundle() as any;
    raw.version = 5;
    raw.worldSessions = {
      world: {
        messages: [],
        meta: {
          id: 'session', novelId: 'novel-1', title: 'A', memory: '', longTermMemory: '', midTermMemories: [], shortTermMemories: [],
          lastMessageAt: raw.exportedAt, createdAt: raw.exportedAt, updatedAt: raw.exportedAt, contextLength: 8192, mainPrompt: '', prefix: '', suffix: '', worldbookEntries: [], backgroundEnabled: false, bubbleOpacity: 1,
        },
        slotBook: {
          activeSlotId: 'slot',
          slots: [{ id: 'slot', name: 'S', createdAt: raw.exportedAt, updatedAt: raw.exportedAt, messages: [{ id: 'same', role: 'user', content: 'x', status: 'complete', createdAt: raw.exportedAt, updatedAt: raw.exportedAt }], memory: '', longTermMemory: '', midTermMemories: [], shortTermMemories: [], lastMessageAt: raw.exportedAt, title: 'A', contextLength: 8192, mainPrompt: '', prefix: '', suffix: '', worldbookEntries: [], backgroundEnabled: false, bubbleOpacity: 1 }],
          previousSnapshot: { id: 'previous', name: 'P', createdAt: raw.exportedAt, updatedAt: raw.exportedAt, messages: [{ id: 'same', role: 'user', content: 'x', status: 'complete', createdAt: raw.exportedAt, updatedAt: raw.exportedAt }], memory: '', longTermMemory: '', midTermMemories: [], shortTermMemories: [], lastMessageAt: raw.exportedAt, title: 'A', contextLength: 8192, mainPrompt: '', prefix: '', suffix: '', worldbookEntries: [], backgroundEnabled: false, bubbleOpacity: 1 },
        },
      },
    };
    expect(parseChatSessionExportBundle(raw).worldSessions?.world.slotBook?.previousSnapshot?.messages).toHaveLength(1);
    raw.worldSessions.world.slotBook.slots.push(raw.worldSessions.world.slotBook.slots[0]);
    expect(() => parseChatSessionExportBundle(raw)).toThrow('存档槽 ID 重复');
  });
});

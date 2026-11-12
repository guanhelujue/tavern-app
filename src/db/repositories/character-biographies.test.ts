import { describe, expect, it, vi } from 'vitest';

import {
  listCharacterBiographies,
  replaceCharacterBiographies,
} from './character-biographies';

describe('character biography repository', () => {
  it('replaces one character collection in stable display order', async () => {
    const runAsync = vi.fn(async () => ({ changes: 1 }));
    const db = { runAsync } as never;
    const entries = [
      {
        id: 'bio-1',
        title: '雨夜',
        request: '写一次雨夜相遇',
        content: '正文一',
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
      },
      {
        id: 'bio-2',
        title: '旧信',
        request: '',
        content: '正文二',
        createdAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:00.000Z',
      },
    ];

    await replaceCharacterBiographies(db, 'novel-1', 'char-1', entries);

    expect(runAsync).toHaveBeenCalledTimes(3);
    expect(runAsync.mock.calls[0]?.slice(1)).toEqual(['novel-1', 'char-1']);
    expect(runAsync.mock.calls[1]?.at(-1)).toBe(0);
    expect(runAsync.mock.calls[2]?.at(-1)).toBe(1);
  });

  it('loads only the requested novel and character', async () => {
    const getAllAsync = vi.fn(async () => []);
    const db = { getAllAsync } as never;

    await listCharacterBiographies(db, 'novel-2', 'char-8');

    expect(getAllAsync).toHaveBeenCalledOnce();
    expect(getAllAsync.mock.calls[0]?.slice(1)).toEqual(['novel-2', 'char-8']);
  });
});

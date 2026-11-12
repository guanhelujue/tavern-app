import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocumentAsync } from 'expo-document-picker';
import { readTextFileAsync } from './file-text';
import { pickWritingModArticle } from './writing-mod-import';

vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('./file-text', () => ({ readTextFileAsync: vi.fn() }));

const pick = vi.mocked(getDocumentAsync);
const read = vi.mocked(readTextFileAsync);

describe('full-text MOD import', () => {
  beforeEach(() => {
    pick.mockReset();
    read.mockReset();
    pick.mockResolvedValue({ canceled: false, assets: [{ name: '长篇.txt', uri: 'file:///fixture.txt', lastModified: 0 }] });
  });

  it('returns the complete file beyond the previous 12000 and 100000 character limits', async () => {
    const raw = `\uFEFF开头\r\n${'原文中段'.repeat(235000)}\n结尾\n`;
    read.mockResolvedValue(raw);
    expect(await pickWritingModArticle()).toEqual({ name: '长篇.txt', text: raw });
    expect(read).toHaveBeenCalledWith('file:///fixture.txt');
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ copyToCacheDirectory: true }));
  });

  it('handles cancellation without reading a file', async () => {
    pick.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickWritingModArticle()).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects empty files and propagates read errors', async () => {
    read.mockResolvedValue(' \n');
    await expect(pickWritingModArticle()).rejects.toThrow('文件为空');
    read.mockRejectedValue(new Error('读取失败'));
    await expect(pickWritingModArticle()).rejects.toThrow('读取失败');
  });
});

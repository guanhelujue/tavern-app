import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { readTextFileAsync } from './file-text';

vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { UTF8: 'utf8', Base64: 'base64' }, readAsStringAsync: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

function serve(bytes: Uint8Array) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(bytes))));
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); Platform.OS = 'web'; });

describe('text file decoding', () => {
  it('reads Windows GBK Chinese instead of producing replacement characters', async () => {
    serve(Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 13, 10]));
    expect(await readTextFileAsync('blob:sample')).toBe('中文\r\n');
  });

  it('supports GB18030 four-byte characters', async () => {
    serve(Uint8Array.from([0x94, 0x39, 0xfc, 0x36]));
    expect(await readTextFileAsync('blob:sample')).toBe('😀');
  });

  it('reports unsupported encodings instead of silently using an incorrect decoder', async () => {
    const OriginalDecoder = TextDecoder;
    vi.stubGlobal('TextDecoder', class extends OriginalDecoder {
      constructor(_encoding?: string, options?: TextDecoderOptions) { super('utf-8', options); }
    });
    serve(Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]));
    await expect(readTextFileAsync('blob:sample')).rejects.toThrow('另存为 UTF-8');
  });

  it('rejects an unsuccessful file response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
    await expect(readTextFileAsync('blob:sample')).rejects.toThrow('读取文件失败');
  });

  it('preserves full UTF-8 text, emoji, whitespace and CRLF, stripping only its BOM', async () => {
    const text = ` 开头😀\r\n${'全文'.repeat(500000)}结尾\n`;
    serve(new TextEncoder().encode(`\uFEFF${text}`));
    expect(await readTextFileAsync('blob:sample')).toBe(text);
  });

  it.each([
    [0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65],
    [0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87],
  ])('reads BOM-marked UTF-16: %j', async (...bytes) => {
    serve(Uint8Array.from(bytes));
    expect(await readTextFileAsync('blob:sample')).toBe('中文');
  });

  it.each([
    [0xff], // Invalid in both UTF-8 and GB18030.
    [0xff, 0xfe, 0x2d], // Truncated UTF-16 must not fall back to GBK.
    [0xef, 0xbb, 0xbf, 0xd6, 0xd0], // Declared UTF-8 but invalid bytes.
    [0x41, 0, 0x42, 0], // Do not silently import BOM-less UTF-16 as ASCII.
  ])('rejects invalid or ambiguous bytes: %j', async (...bytes) => {
    serve(Uint8Array.from(bytes));
    await expect(readTextFileAsync('blob:sample')).rejects.toThrow(/编码|损坏|乱码/);
  });

  it('rejects replacement characters already saved inside valid UTF-8', async () => {
    serve(new TextEncoder().encode('正文����结尾'));
    await expect(readTextFileAsync('blob:sample')).rejects.toThrow(/损坏|乱码/);
  });

  it('reads native bytes as Base64 before decoding', async () => {
    Platform.OS = 'android';
    vi.mocked(readAsStringAsync).mockResolvedValue('1tDOxA==');
    expect(await readTextFileAsync('file:///sample.txt')).toBe('中文');
    expect(readAsStringAsync).toHaveBeenCalledWith('file:///sample.txt', { encoding: 'base64' });
  });

  it('preserves network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('读取失败')));
    await expect(readTextFileAsync('blob:sample')).rejects.toThrow('读取失败');
  });
});

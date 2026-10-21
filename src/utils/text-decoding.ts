const ENCODING_ERROR = '无法可靠识别文本编码，或文件已经损坏。请用记事本确认中文正常后另存为 UTF-8，再重新导入。';

/** Also used before extraction, so old imports and pasted damaged text cannot reach the API. */
export function assertReadableText(text: string): void {
  if (text.includes('\uFFFD')) {
    throw new Error('正文含有乱码替换字符（�），可能已在读取或保存时损坏。请从中文正常的原文件重新导入，或复制正常显示的正文；更换模型无法恢复丢失文字。');
  }
  // NUL generally indicates binary content or UTF-16 without a reliable byte-order marker.
  if (text.includes('\u0000')) throw new Error(ENCODING_ERROR);
}

function decodeStrict(bytes: Uint8Array, encoding: string): string {
  const decoder = new TextDecoder(encoding, { fatal: true });
  // Some native runtimes only implement UTF-8. Never silently accept an ignored encoding label.
  if (decoder.encoding !== encoding) throw new Error(ENCODING_ERROR);
  return decoder.decode(bytes);
}

/** BOM first, otherwise strict UTF-8, then Chinese Windows GBK/GB18030. Never truncate. */
export function decodeTextFileBytes(bytes: Uint8Array): string {
  let text: string;
  const bomEncoding = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? 'utf-8'
    : bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null;
  try {
    if (bomEncoding) {
      // A declared but invalid encoding is damage, not permission to guess a different encoding.
      text = decodeStrict(bytes, bomEncoding);
    } else {
      try {
        text = decodeStrict(bytes, 'utf-8');
      } catch {
        text = decodeStrict(bytes, 'gb18030');
      }
    }
  } catch {
    throw new Error(ENCODING_ERROR);
  }
  assertReadableText(text);
  return text;
}

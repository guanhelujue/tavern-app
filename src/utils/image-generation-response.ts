import type { GeneratedImageSource } from '@/types/image-generation';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function mimeFromDataUri(value: string) {
  const match = value.match(/^data:([^;,]+)[;,]/i);
  return match?.[1]?.trim() || undefined;
}

function imageSourceFromValue(value: unknown): GeneratedImageSource | undefined {
  const record = asRecord(value);
  if (!record) {
    const text = asString(value);
    if (!text) return undefined;
    if (/^data:image\//i.test(text)) return { uri: text, mimeType: mimeFromDataUri(text) };
    if (/^https?:\/\//i.test(text) && /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(text)) {
      return { uri: text };
    }
    const markdown = text.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/i)?.[1];
    return markdown ? { uri: markdown } : undefined;
  }

  const mimeType =
    asString(record.mime_type) ||
    asString(record.mimeType) ||
    asString(asRecord(record.inline_data)?.mime_type) ||
    asString(asRecord(record.inlineData)?.mimeType) ||
    undefined;

  const dataUri = asString(record.url) || asString(record.uri);
  if (dataUri) {
    return {
      uri: dataUri,
      mimeType: mimeType || mimeFromDataUri(dataUri),
    };
  }

  const nestedImageUrl = asRecord(record.image_url) ?? asRecord(record.imageUrl);
  const nestedUrl = asString(nestedImageUrl?.url);
  if (nestedUrl) {
    return { uri: nestedUrl, mimeType: mimeType || mimeFromDataUri(nestedUrl) };
  }

  const inline = asRecord(record.inline_data) ?? asRecord(record.inlineData);
  const inlineData = asString(inline?.data);
  if (inlineData) {
    return { base64: inlineData, mimeType: mimeType || 'image/png' };
  }

  const base64 =
    asString(record.b64_json) ||
    asString(record.b64Json) ||
    asString(record.base64) ||
    asString(record.data);
  if (base64 && !/^https?:\/\//i.test(base64)) {
    return { base64, mimeType: mimeType || 'image/png' };
  }

  // OpenAI Responses image_generation calls return the image bytes directly
  // on output[].result instead of using the Image API's data[].b64_json shape.
  const responseImageResult = asString(record.result);
  if (responseImageResult) {
    if (/^data:image\//i.test(responseImageResult)) {
      return {
        uri: responseImageResult,
        mimeType: mimeType || mimeFromDataUri(responseImageResult),
      };
    }
    return { base64: responseImageResult, mimeType: mimeType || 'image/png' };
  }

  return undefined;
}

function findImageSource(value: unknown, depth = 0): GeneratedImageSource | undefined {
  if (depth > 6) return undefined;

  const direct = imageSourceFromValue(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageSource(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ['choices', 'data', 'images', 'output', 'outputs', 'content', 'message', 'parts', 'candidates']) {
    if (!(key in record)) continue;
    const found = findImageSource(record[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function parseGeneratedImageResponse(payload: unknown): GeneratedImageSource {
  const source = findImageSource(payload);
  if (!source) {
    throw new Error('图像模型已返回，但响应中没有找到图片数据。请检查本地网关的图像响应格式。');
  }
  return source;
}

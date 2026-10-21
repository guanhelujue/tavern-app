/**
 * Substrings that mark a model as unsuitable for chat / novel text generation.
 * Matched case-insensitively against the raw model id.
 */
const NON_TEXT_MODEL_KEYWORDS = [
  // embeddings / ranking / safety
  'embedding',
  'embed',
  'rerank',
  'moderation',
  // vision / image gen
  'vision',
  'image',
  'imagen',
  'dall-e',
  'dalle',
  'midjourney',
  'stable-diffusion',
  'sdxl',
  'flux',
  'inpainting',
  // video / music / audio gen
  'veo',
  'sora',
  'lyria',
  'video',
  'music',
  'audio',
  'tts',
  'speech',
  'voice',
  // speech recognition (incl. MiMo ASR, Whisper, etc.)
  'asr',
  'stt',
  'whisper',
  'transcribe',
  // realtime / agent / robotics (not plain chat)
  'realtime',
  'omni',
  'robotics',
  'computer-use',
  'computer_use',
  // misc multimodal tooling
  'clip',
  'aqa',
] as const;

export function isTextOnlyModelId(modelId: string) {
  const normalized = modelId.toLowerCase();

  return !NON_TEXT_MODEL_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function filterTextModels(modelIds: string[]) {
  return modelIds
    .map((modelId) => modelId.trim())
    .filter(Boolean)
    .filter(isTextOnlyModelId);
}

export function buildModelsEndpoint(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '');

  if (!normalized) {
    return '';
  }

  if (
    normalized.endsWith('/v1') ||
    normalized.endsWith('/openai') ||
    /\/v\d+[a-z]*\/openai$/i.test(normalized)
  ) {
    return `${normalized}/models`;
  }

  return `${normalized}/v1/models`;
}

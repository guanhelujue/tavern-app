import type { OpenAIChatMessage } from '@/types/tavern';

/** Gemini adjustable filters — OFF is preferred on 2.5+; BLOCK_NONE as fallback wording. */
export const GEMINI_PERMISSIVE_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'OFF' },
] as const;

/** Return fresh request objects so every native Gemini call uses the same thresholds. */
export function geminiPermissiveSafetySettings() {
  return GEMINI_PERMISSIVE_SAFETY_SETTINGS.map(({ category, threshold }) => ({ category, threshold }));
}

export function isGeminiGenerativeLanguageBaseUrl(baseUrl: string) {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl.trim());
}

/** `…/v1beta/openai` → `…/v1beta` for native generateContent. */
export function resolveGeminiNativeRoot(baseUrl: string) {
  const root = baseUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!root) {
    return root;
  }
  if (/\/v1beta\/models\/[^/]+:generateContent$/i.test(root)) {
    return root.replace(/\/models\/[^/]+:generateContent$/i, '');
  }
  if (/\/v1beta\/openai$/i.test(root)) {
    return root.replace(/\/openai$/i, '');
  }
  if (/\/v1beta$/i.test(root)) {
    return root;
  }
  if (/\/v1$/i.test(root)) {
    return root.replace(/\/v1$/i, '/v1beta');
  }
  return `${root}/v1beta`;
}

export function normalizeGeminiModelId(model: string) {
  const id = model.trim().replace(/^models\//i, '');
  return id || model.trim();
}

type GeminiPart = {
  text?: string;
  /** Gemini thought summaries are marked on individual response parts. */
  thought?: boolean;
  thoughtSignature?: string;
};

type GeminiContent = {
  role?: 'user' | 'model';
  parts: GeminiPart[];
};

type GeminiNativeResponse = {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  promptFeedback?: {
    blockReason?: string;
    blockReasonMessage?: string;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: {
    message?: string;
    status?: string;
  };
};

export type GeminiNativeResult = {
  content: string;
  reasoningContent?: string;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
};

function mapGeminiFinishReason(reason?: string, blockReason?: string): string | undefined {
  const blocked = (blockReason || reason || '').trim().toUpperCase();
  if (!blocked) {
    return undefined;
  }

  if (
    blocked === 'SAFETY' ||
    blocked === 'PROHIBITED_CONTENT' ||
    blocked === 'BLOCKLIST' ||
    blocked === 'SPII' ||
    blocked === 'IMAGE_SAFETY' ||
    blocked.includes('PROHIBITED')
  ) {
    return `content_filter: ${blocked}`;
  }

  if (blocked === 'MAX_TOKENS' || blocked === 'LENGTH') {
    return 'length';
  }

  if (blocked === 'STOP' || blocked === 'FINISH_REASON_UNSPECIFIED') {
    return 'stop';
  }

  return blocked.toLowerCase();
}

function splitThoughtParts(parts?: GeminiPart[]): {
  content: string;
  reasoningContent: string;
} {
  if (!Array.isArray(parts)) {
    return { content: '', reasoningContent: '' };
  }

  const content: string[] = [];
  const reasoning: string[] = [];
  for (const part of parts) {
    if (typeof part?.text !== 'string' || !part.text) {
      continue;
    }
    (part.thought ? reasoning : content).push(part.text);
  }

  return {
    content: content.join('').trim(),
    reasoningContent: reasoning.join('').trim(),
  };
}

/** Convert OpenAI-style messages to Gemini `contents` + optional `systemInstruction`. */
export function openAiMessagesToGemini(messages: OpenAIChatMessage[]): {
  systemInstruction?: { parts: GeminiPart[] };
  contents: GeminiContent[];
} {
  const systemChunks: string[] = [];
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    const text = message.content?.trim() ?? '';
    if (!text) {
      continue;
    }

    if (message.role === 'system') {
      systemChunks.push(text);
      continue;
    }

    const role: 'user' | 'model' = message.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];

    if (last && last.role === role) {
      last.parts.push({ text });
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  // Gemini requires the first content turn to be `user`.
  if (contents.length > 0 && contents[0].role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: '（继续）' }] });
  }

  return {
    systemInstruction: systemChunks.length
      ? { parts: [{ text: systemChunks.join('\n\n') }] }
      : undefined,
    contents,
  };
}

function buildGeminiRequestBody({
  messages,
  temperature,
  maxTokens,
  includeThoughts,
}: {
  messages: OpenAIChatMessage[];
  temperature: number;
  maxTokens: number;
  includeThoughts: boolean;
}) {
  const { systemInstruction, contents } = openAiMessagesToGemini(messages);

  return {
    ...(systemInstruction ? { systemInstruction } : {}),
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(includeThoughts ? { thinkingConfig: { includeThoughts: true } } : {}),
    },
    safetySettings: geminiPermissiveSafetySettings(),
  };
}

function parseGeminiPayload(data: GeminiNativeResponse): GeminiNativeResult {
  if (data.error?.message) {
    throw new Error(data.error.message);
  }

  const blockReason = data.promptFeedback?.blockReason;
  const candidate = data.candidates?.[0];
  const split = splitThoughtParts(candidate?.content?.parts);
  const content = split.content;
  const finishReason = mapGeminiFinishReason(candidate?.finishReason, blockReason);

  if (!content && blockReason) {
    return {
      content: '',
      reasoningContent: split.reasoningContent || undefined,
      finishReason: mapGeminiFinishReason(undefined, blockReason),
      promptTokens: data.usageMetadata?.promptTokenCount,
      completionTokens: data.usageMetadata?.candidatesTokenCount,
    };
  }

  return {
    content,
    reasoningContent: split.reasoningContent || undefined,
    finishReason,
    promptTokens: data.usageMetadata?.promptTokenCount,
    completionTokens: data.usageMetadata?.candidatesTokenCount,
  };
}

async function readGeminiSseStream(
  response: Response,
  onDelta?: (delta: string) => void,
  onReasoningDelta?: (delta: string) => void,
): Promise<GeminiNativeResult> {
  if (!response.body) {
    const text = await response.text();
    const data = JSON.parse(text) as GeminiNativeResponse;
    return parseGeminiPayload(data);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoningContent = '';
  let finishReason: string | undefined;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n');
    buffer = chunks.pop() ?? '';

    for (const line of chunks) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        continue;
      }

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        continue;
      }

      let data: GeminiNativeResponse;
      try {
        data = JSON.parse(payload) as GeminiNativeResponse;
      } catch {
        continue;
      }

      if (data.error?.message) {
        throw new Error(data.error.message);
      }

      const split = splitThoughtParts(data.candidates?.[0]?.content?.parts);
      const piece = split.content;
      // Native SSE chunks are incremental text parts (not full cumulative snapshots).
      if (piece) {
        content += piece;
        onDelta?.(piece);
      }
      if (split.reasoningContent) {
        reasoningContent += split.reasoningContent;
        onReasoningDelta?.(split.reasoningContent);
      }

      const mapped = mapGeminiFinishReason(
        data.candidates?.[0]?.finishReason,
        data.promptFeedback?.blockReason,
      );
      if (mapped) {
        finishReason = mapped;
      }

      if (typeof data.usageMetadata?.promptTokenCount === 'number') {
        promptTokens = data.usageMetadata.promptTokenCount;
      }
      if (typeof data.usageMetadata?.candidatesTokenCount === 'number') {
        completionTokens = data.usageMetadata.candidatesTokenCount;
      }
    }
  }

  return {
    content: content.trim(),
    reasoningContent: reasoningContent.trim() || undefined,
    finishReason,
    promptTokens,
    completionTokens,
  };
}

/**
 * Call Gemini native generateContent / streamGenerateContent with permissive safety settings.
 * OpenAI-compat layer does not reliably honor safety_settings for chat.
 */
export async function completeGeminiNative({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  streaming,
  includeThoughts = false,
  signal,
  onDelta,
  onReasoningDelta,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: OpenAIChatMessage[];
  temperature: number;
  maxTokens: number;
  streaming: boolean;
  /** Ask Gemini for visible thought summaries (not raw hidden chain-of-thought). */
  includeThoughts?: boolean;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
}): Promise<GeminiNativeResult> {
  const root = resolveGeminiNativeRoot(baseUrl);
  const modelId = normalizeGeminiModelId(model);
  const action = streaming ? 'streamGenerateContent' : 'generateContent';
  const key = apiKey.trim();
  // Native Generative Language API expects API key via x-goog-api-key (or ?key=),
  // not Authorization: Bearer (that path expects OAuth access tokens).
  const queryParts: string[] = [];
  if (streaming) {
    queryParts.push('alt=sse');
  }
  if (key) {
    queryParts.push(`key=${encodeURIComponent(key)}`);
  }
  const query = queryParts.length ? `?${queryParts.join('&')}` : '';
  const url = `${root}/models/${encodeURIComponent(modelId)}:${action}${query}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (key) {
    headers['x-goog-api-key'] = key;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      buildGeminiRequestBody({
        messages,
        temperature,
        maxTokens,
        includeThoughts,
      }),
    ),
    signal,
  });

  if (streaming) {
    if (!response.ok) {
      const responseText = await response.text();
      let message = responseText || `请求失败：HTTP ${response.status}`;
      try {
        const errJson = JSON.parse(responseText) as GeminiNativeResponse;
        if (errJson.error?.message) {
          message = errJson.error.message;
        }
      } catch {
        // keep raw
      }
      throw new Error(message);
    }

    return readGeminiSseStream(response, onDelta, onReasoningDelta);
  }

  const responseText = await response.text();
  let data: GeminiNativeResponse;
  try {
    data = JSON.parse(responseText) as GeminiNativeResponse;
  } catch {
    throw new Error(responseText || `请求失败：HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(data.error?.message || responseText || `请求失败：HTTP ${response.status}`);
  }

  const result = parseGeminiPayload(data);
  if (result.content) {
    onDelta?.(result.content);
  }
  return result;
}

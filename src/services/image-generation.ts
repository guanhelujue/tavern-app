import { DEFAULT_IMAGE_MODEL, imageModelCatalogEntry } from '../constants/image-models';
import type { ImageGenerationPurpose } from '../types/image-generation';
import type {
  ImageProviderAuth,
  ImageProviderProtocol,
} from '../types/tavern';
import { persistGeneratedImage, readNovelImageAsInlineData } from '../utils/novel-images';
import { parseGeneratedImageResponse } from '../utils/image-generation-response';
import { asRecord } from '../utils/helpers';
import { geminiPermissiveSafetySettings } from './gemini-native';

export { DEFAULT_IMAGE_MODEL } from '../constants/image-models';

export type ImageApiSettings = {
  baseUrl: string;
  apiKey: string;
  protocol?: ImageProviderProtocol;
  auth?: ImageProviderAuth;
  /** Keep compatibility with callers that pass the broader LLM settings object. */
  [key: string]: unknown;
};

export type ImageGenerationResult = {
  uri: string;
  model: string;
  purpose: ImageGenerationPurpose;
};

export function imageProtocolSupportsReferenceImage(
  protocol?: ImageProviderProtocol,
) {
  return protocol !== 'openai-images';
}

function isGeminiBaseUrl(baseUrl: string) {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl.trim());
}

function normalizeGeminiImageModel(model: string) {
  return model.trim().replace(/^models\//i, '');
}

function resolveGeminiImageRoot(baseUrl: string) {
  const root = baseUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
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

function resolveOpenAiEndpoint(baseUrl: string, path: '/responses' | '/images/generations') {
  const root = baseUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!root) throw new Error('请先配置图像模型 Base URL。');
  if (root.endsWith(path)) return root;
  return /\/v1$/i.test(root) ? `${root}${path}` : `${root}/v1${path}`;
}

function resolveImageEndpoint(
  baseUrl: string,
  model: string,
  protocol: ImageProviderProtocol | undefined,
  useGeminiNative: boolean,
) {
  const root = baseUrl.trim().replace(/\/+$/, '');
  if (!root) throw new Error('请先配置图像模型 Base URL。');
  if (useGeminiNative) {
    const nativeRoot = resolveGeminiImageRoot(root);
    const modelId = encodeURIComponent(normalizeGeminiImageModel(model));
    return `${nativeRoot}/models/${modelId}:generateContent`;
  }
  if (protocol === 'openai-images') {
    return resolveOpenAiEndpoint(root, '/images/generations');
  }
  if (protocol === 'openai-responses-image') {
    return resolveOpenAiEndpoint(root, '/responses');
  }
  return /\/v1(?:\/|$)/i.test(root) ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
}

function buildHeaders(apiSettings: ImageApiSettings, useGeminiNative: boolean) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = apiSettings.apiKey.trim();
  if (!apiKey || apiSettings.auth === 'none') return headers;
  if (useGeminiNative || apiSettings.auth === 'x-goog-api-key') headers['x-goog-api-key'] = apiKey;
  else if (apiSettings.auth === 'x-api-key') headers['x-api-key'] = apiKey;
  else headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export async function generateImage({
  apiSettings,
  purpose,
  prompt,
  model = DEFAULT_IMAGE_MODEL,
  fetchImpl = globalThis.fetch,
  signal,
  referenceImageUri,
}: {
  apiSettings: ImageApiSettings;
  purpose: ImageGenerationPurpose;
  prompt: string;
  model?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Optional visual identity reference for providers that accept multimodal input. */
  referenceImageUri?: string | null;
}): Promise<ImageGenerationResult> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error('请先填写图像生成提示词。');
  const selectedModel = model.trim() || DEFAULT_IMAGE_MODEL;
  const modelPreset = imageModelCatalogEntry(selectedModel);
  const protocol =
    !apiSettings.protocol || apiSettings.protocol === 'auto'
      ? modelPreset?.protocol
      : apiSettings.protocol;
  const auth =
    !apiSettings.auth || apiSettings.auth === 'auto' ? modelPreset?.auth : apiSettings.auth;
  const useGeminiNative =
    protocol === 'google-generate-content' ||
    isGeminiBaseUrl(apiSettings.baseUrl);
  if (
    protocol &&
    !useGeminiNative &&
    !['openai-compatible', 'openai-images', 'openai-responses-image'].includes(protocol)
  ) {
    throw new Error(
      '当前图像适配版仅支持 OpenAI-compatible、OpenAI Images、OpenAI Responses image 或 Gemini generateContent 协议。',
    );
  }

  const endpoint = resolveImageEndpoint(
    apiSettings.baseUrl,
    selectedModel,
    protocol,
    useGeminiNative,
  );
  const requestUrl =
    useGeminiNative && apiSettings.apiKey.trim()
      ? `${endpoint}?key=${encodeURIComponent(apiSettings.apiKey.trim())}`
      : endpoint;
  // The JSON /images/generations endpoint cannot carry an input image. Other
  // supported protocols are multimodal and can receive the identity plate.
  const supportsReferenceImage = imageProtocolSupportsReferenceImage(protocol);
  const referenceImage = supportsReferenceImage && referenceImageUri?.trim()
    ? await readNovelImageAsInlineData(referenceImageUri.trim())
    : undefined;
  const identityInstruction = referenceImage
    ? `${cleanPrompt}\n\n身份参考图规则（最高视觉优先级）：随请求附带的图片是目标人物本人的身份原图，不是仅供取色或借鉴画风的普通参考。输出必须是同一个人在新场景中的另一张照片：严格保持面部身份、骨相、脸型、五官比例、眼型与眼距、鼻形、唇形、发际线、发型发色、肤色、年龄观感和体格；只改变场景、服装、姿势、光线与镜头。不得重新选角、换脸、平均化五官或融合另一张脸。若参考图是真人照片，必须延续写实摄影媒介，不得转成动漫、插画、数字绘画、游戏原画、3D 渲染或介于真人与动漫之间的混合风格。`
    : cleanPrompt;
  const body = useGeminiNative
    ? {
        contents: [{
          role: 'user',
          parts: [
            ...(referenceImage
              ? [{ inlineData: { mimeType: referenceImage.mimeType, data: referenceImage.base64 } }]
              : []),
            { text: identityInstruction },
          ],
        }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        safetySettings: geminiPermissiveSafetySettings(),
      }
    : protocol === 'openai-images'
      ? {
          model: selectedModel,
          prompt: identityInstruction,
          n: 1,
        }
      : protocol === 'openai-responses-image'
        ? {
            model: selectedModel,
            input: referenceImage
              ? [{ role: 'user', content: [
                  { type: 'input_text', text: identityInstruction },
                  { type: 'input_image', image_url: referenceImage.dataUri },
                ] }]
              : identityInstruction,
            tools: [{ type: 'image_generation' }],
          }
        : {
            model: selectedModel,
            messages: [{
              role: 'user',
              content: referenceImage
                ? [
                    { type: 'text', text: identityInstruction },
                    { type: 'image_url', image_url: { url: referenceImage.dataUri } },
                  ]
                : identityInstruction,
            }],
            stream: false,
          };

  const response = await fetchImpl(requestUrl, {
    method: 'POST',
    headers: buildHeaders({ ...apiSettings, auth }, useGeminiNative),
    body: JSON.stringify(body),
    signal,
  });
  const raw = await response.text();
  let payload: unknown;
  try {
    payload = raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const error = (asRecord(asRecord(payload)?.error)?.message as string | undefined)?.trim();
    throw new Error(error || raw || `图像请求失败：HTTP ${response.status}`);
  }

  const source = parseGeneratedImageResponse(payload);
  const uri = await persistGeneratedImage(source, purpose === 'scene' ? 'background' : purpose);
  return { uri, model: selectedModel, purpose };
}

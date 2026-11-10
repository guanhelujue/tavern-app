import { DEFAULT_IMAGE_MODEL, imageModelCatalogEntry, LOCAL_IMAGE_MODEL_IDS, type LocalImageModelId } from '../constants/image-models';
import type { ComfyImageOutput, ImageGenerationMode, ImageGenerationOptions, ImageGenerationPurpose } from '../types/image-generation';
import type {
  ImageProviderAuth,
  ImageProviderProtocol,
} from '../types/tavern';
import { persistGeneratedImage, readNovelImageAsInlineData } from '../utils/novel-images';
import { parseGeneratedImageResponse } from '../utils/image-generation-response';
import { asRecord } from '../utils/helpers';
import { geminiPermissiveSafetySettings } from './gemini-native';
import { generateComfyImage } from './comfyui-image-generation';
import { traceImageRequest, withImageRequestTrace, type ImageTraceSettings } from './image-request-trace';

export { DEFAULT_IMAGE_MODEL } from '../constants/image-models';

export type ImageApiSettings = ImageTraceSettings & {
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
  width?: number;
  height?: number;
  seed?: number;
  mode?: ImageGenerationMode;
  promptId?: string;
  comfyOutput?: ComfyImageOutput;
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

const FACE_REFERENCE_RULE = '身份参考图规则（最高视觉优先级）：随请求附带的图片只用于锁定目标人物的脸部身份，不是服装、姿势、动作或构图参考。输出必须保持同一张脸：脸型、骨相、五官比例、眼型与眼距、鼻形、唇形以及面部肤色和特征一致；发型、发色、服装、配饰、姿势、动作、体态、体格、年龄观感与场景均不要求与参考图相同，可按当前提示词重新设计。不得重新选角、换脸、平均化五官或融合另一张脸。若参考图是真人照片，必须延续写实摄影媒介，不得转成动漫、插画、数字绘画、游戏原画、3D 渲染或介于真人与动漫之间的混合风格。';

function withFaceReferenceRule(prompt: string, hasReference: boolean) {
  return hasReference ? `${prompt}\n\n${FACE_REFERENCE_RULE}` : prompt;
}

export function generateImage(options: Parameters<typeof generateImageRequest>[0]): Promise<ImageGenerationResult> {
  const model = options.model?.trim() || (options.apiSettings.protocol === 'comfyui' ? DEFAULT_IMAGE_MODEL : '未配置模型');
  return withImageRequestTrace(options.apiSettings, model, options.purpose, options.prompt,
    (debugTrace) => generateImageRequest({ ...options, apiSettings: { ...options.apiSettings, debugTrace },
      onProgress: (progress) => {
        debugTrace?.progress(progress.message ?? progress.phase, progress.promptId);
        options.onProgress?.(progress);
      },
    }));
}

async function generateImageRequest({
  apiSettings,
  purpose,
  prompt,
  model,
  fetchImpl = globalThis.fetch,
  signal,
  referenceImageUri,
  referenceImageUris,
  width,
  height,
  negativePrompt,
  seed,
  denoise,
  steps,
  resumePromptId,
  onSubmitted,
  onProgress,
}: ImageGenerationOptions & {
  apiSettings: ImageApiSettings;
  purpose: ImageGenerationPurpose;
  prompt: string;
  model?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ImageGenerationResult> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error('请先填写图像生成提示词。');
  const requestedModel = model?.trim() || '';
  const hasReferenceImage = Boolean(
    referenceImageUri?.trim() || referenceImageUris?.some((uri) => uri.trim()),
  );
  const explicitProtocol = apiSettings.protocol && apiSettings.protocol !== 'auto'
    ? apiSettings.protocol
    : undefined;
  const selectedModel = requestedModel || (explicitProtocol === 'comfyui' ? DEFAULT_IMAGE_MODEL : '');
  if (!selectedModel) throw new Error('请先配置图像模型 ID。');
  const modelPreset = imageModelCatalogEntry(selectedModel);
  const resolvedProtocol = explicitProtocol ?? modelPreset?.protocol ?? (
    LOCAL_IMAGE_MODEL_IDS.includes(selectedModel as LocalImageModelId) ? 'comfyui' : undefined
  );
  if (resolvedProtocol === 'comfyui') {
    if (!LOCAL_IMAGE_MODEL_IDS.includes(selectedModel as LocalImageModelId)) {
      throw new Error('本地图像接口仅支持 Qwen Image 2.1、MOSS 和 Z-Image。');
    }
    const result = await generateComfyImage({
      apiSettings, model: selectedModel as LocalImageModelId,
      prompt: withFaceReferenceRule(cleanPrompt, hasReferenceImage), fetchImpl, signal,
      referenceImageUri, referenceImageUris, width, height, negativePrompt, seed, denoise, steps,
      resumePromptId, onSubmitted, onProgress,
    });
    onProgress?.({ phase: 'saving', promptId: result.promptId, message: '保存生成图片' });
    const uri = await persistGeneratedImage(result.source, purpose === 'scene' ? 'background' : purpose);
    return { uri, model: selectedModel, purpose, width: result.width, height: result.height,
      seed: result.seed, mode: result.mode, promptId: result.promptId, comfyOutput: result.output };
  }
  const protocol = resolvedProtocol;
  const auth =
    explicitProtocol
      ? (apiSettings.auth && apiSettings.auth !== 'auto' ? apiSettings.auth : 'bearer')
      : (!apiSettings.auth || apiSettings.auth === 'auto' ? modelPreset?.auth : apiSettings.auth);
  const useGeminiNative =
    protocol === 'google-generate-content' ||
    (!explicitProtocol && isGeminiBaseUrl(apiSettings.baseUrl));
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
  const identityInstruction = withFaceReferenceRule(cleanPrompt, Boolean(referenceImage));
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

  const payload = await traceImageRequest(apiSettings.debugTrace,
    { label: '提交图像生成请求', method: 'POST', url: requestUrl, body }, async (report) => {
      const response = await fetchImpl(requestUrl, {
        method: 'POST',
        headers: buildHeaders({ ...apiSettings, auth }, useGeminiNative),
        body: JSON.stringify(body),
        signal,
      });
      report(response.status);
      const raw = await response.text();
      let payload: unknown;
      try {
        payload = raw ? (JSON.parse(raw) as unknown) : undefined;
      } catch {
        payload = undefined;
      }
      report(response.status, payload ?? raw);
      if (!response.ok) {
        const error = (asRecord(asRecord(payload)?.error)?.message as string | undefined)?.trim();
        throw new Error(error || raw || `图像请求失败：HTTP ${response.status}`);
      }
      return payload;
    });

  const source = parseGeneratedImageResponse(payload);
  onProgress?.({ phase: 'saving', message: '保存生成图片' });
  const uri = await persistGeneratedImage(source, purpose === 'scene' ? 'background' : purpose);
  return { uri, model: selectedModel, purpose };
}

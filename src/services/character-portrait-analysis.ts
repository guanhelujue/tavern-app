import { parseAiJson } from '@/utils/ai-json';
import { normalizeCharacterAiSummary } from '../features/character-dossier-v2/ai-summary';
import { CHARACTER_PRIVATE_DOSSIER_SCHEMA } from '../features/character-dossier-v2/generation-prompt';
import { buildNsfwCharacterCreatePrompt } from '../constants/content-scale';
import {
  mergeCharacterDossierV2,
  normalizeCharacterDossierV2,
} from '../features/character-dossier-v2/model';
import {
  buildPortraitFieldProposals,
  type PortraitFieldProposal,
  type PortraitProposalSource,
} from '../features/character-dossier-v2/portrait-proposal';
import {
  geminiPermissiveSafetySettings,
  normalizeGeminiModelId,
  resolveGeminiNativeRoot,
} from './gemini-native';
import type { CharacterAiSummary } from '../types/character-dossier-v2';
import type { ApiSettings, NovelCastCharacter } from '../types/tavern';
import { asRecord, asString } from '../utils/helpers';
import { readNovelImageAsInlineData } from '../utils/novel-images';
import { recoverStructuredResponse } from './structured-response';

type PortraitAnalysisPayload = {
  cast?: Record<string, unknown>;
  dossierV2?: unknown;
  aiSummary?: Partial<CharacterAiSummary> | null;
  fieldEvidence?: Record<string, PortraitProposalSource>;
};

export type CharacterPortraitAnalysisResult = {
  character: NovelCastCharacter;
  target: CharacterPortraitAnalysisTarget;
  promptTokens: number;
  completionTokens: number;
  modelId?: string;
  changes: PortraitFieldProposal[];
};

export type CharacterPortraitAnalysisTarget = 'public' | 'private';

export function buildCharacterPortraitAnalysisSystemPrompt(
  nsfwEnabled: boolean,
  _nsfwPrompt?: string,
  target: CharacterPortraitAnalysisTarget = 'public',
) {
  if (target === 'private') {
    return `你是小说角色私密档案的视觉取证员。用户会提供一张虚构角色的私密参考图、当前草稿和世界设定。

只处理 dossierV2.private：从图片记录可见的稳定私密身体特征；无法从静态图片直接看出的敏感区域、身体反应、经验、偏好与习惯，只能结合当前人设作自洽的虚构推演，并在 fieldEvidence 中标为 inferred。不得修改 cast 或 dossierV2.public，不得把姿势、动作、临时状态、摄影风格或光线写成稳定身体特征，不得识别现实人物。

只输出一个可解析 JSON，不要 Markdown 或解释：
{
  "cast": {},
  "dossierV2": {
    "version": 2,
    "public": {},
    "private": "按下方对应性别输出完整对象"
  },
  "aiSummary": { "version": 1, "privateFacts": ["只放稳定私密事实"] },
  "fieldEvidence": {
    "dossierV2.private.intimateBody": "observed",
    "dossierV2.private.sexualResponse": "inferred",
    "dossierV2.private.intimacyProfile": "inferred"
  }
}

内容模式：NSFW。只生成虚构角色的稳定私密档案，不写正在发生的性行为场景。
${CHARACTER_PRIVATE_DOSSIER_SCHEMA}
${buildNsfwCharacterCreatePrompt(true)}`;
  }

  return `你是小说角色档案的视觉取证员与人设设计师。用户会提供一张角色参考图、当前草稿和世界设定。

先从图片中提取可见事实：脸型、五官、头发、肤色、年龄阶段、身材轮廓、姿态、服装、配饰、表情与明确身份线索；再结合世界设定对无法直接看出的姓名、职业、精确身体数值、性格、说话方式、背景与动机做一套自洽的虚构补全。

不得识别或猜测照片中现实人物的真实姓名、种族、国籍、疾病、宗教或政治立场；只把图片当作虚构角色的视觉参考。

当前草稿非空字段是作者锁定事实，必须原样保留。不要把画面风格、滤镜、摄影光线当成人物的生理特征。

字段分流：appearance 只写脸型、五官、肤色、发型和面部辨识特征；身材轮廓与身体比例写入 dossierV2.public.bodyStats；服装、配饰和贴身衣物写入 dossierV2.public.clothingStyle；姿态、动作和表情不写入稳定外貌。

只输出一个可解析 JSON，不要 Markdown 或解释：
{
  "cast": {
    "name":"", "profession":"", "age":"", "gender":"", "height":"", "weight":"",
    "birthplace":"", "affiliation":"", "appearance":"", "personality":"", "speechStyle":"",
    "background":"", "motive":"", "strengths":"", "weaknesses":""
  },
  "dossierV2": {
    "version":2,
    "public": {
      "birthDate":"", "residence":"", "bodyFat":"", "measurements":"", "shoeSize":"",
      "bodyStats":"", "clothingStyle":"", "personalityAndLife":""
    },
    "private":null
  },
  "aiSummary": {
    "version":1,
    "appearanceAnchors":["最多4条"], "clothingAnchors":["最多3条"],
    "personalityCore":["最多4条"], "behaviorRules":["最多4条"],
    "speechRules":["最多3条"], "motivation":"",
    "relationshipStances":[], "hardLimits":["最多3条"], "privateFacts":[]
  },
  "fieldEvidence": {
    "appearance":"observed",
    "dossierV2.public.clothingStyle":"observed",
    "profession":"inferred"
  }
}

内容模式：日常公开档案。无论全局 NSFW 是否开启，都必须保持 dossierV2.private = null，aiSummary.privateFacts 必须为空数组；不得根据日常照生成或推断私密字段。`;
}

function extractJsonObject(raw: string): PortraitAnalysisPayload | null {
  const source = raw.trim();
  const candidates = [source];
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(source.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = parseAiJson(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as PortraitAnalysisPayload;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function endpointRoot(baseUrl: string) {
  return baseUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
}

function openAiEndpoint(baseUrl: string, path: 'chat/completions' | 'responses') {
  const root = endpointRoot(baseUrl);
  if (root.endsWith(`/${path}`)) return root;
  return /\/v1$/i.test(root) ? `${root}/${path}` : `${root}/v1/${path}`;
}

function headersFor(apiSettings: ApiSettings) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = apiSettings.apiKey.trim();
  if (!apiKey) return headers;
  if (apiSettings.protocol === 'anthropic-messages' || apiSettings.auth === 'x-api-key') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (apiSettings.protocol === 'google-generate-content' || apiSettings.auth === 'x-goog-api-key') {
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function responseText(payload: unknown, protocol: ApiSettings['protocol']) {
  const root = asRecord(payload);
  if (protocol === 'google-generate-content') {
    const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
    const content = asRecord(asRecord(candidates[0])?.content);
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    return parts.map((part) => asString(asRecord(part)?.text)).filter(Boolean).join('\n');
  }
  if (protocol === 'anthropic-messages') {
    const content = Array.isArray(root?.content) ? root.content : [];
    return content.map((part) => asString(asRecord(part)?.text)).filter(Boolean).join('\n');
  }
  if (protocol === 'openai-responses') {
    const direct = asString(root?.output_text);
    if (direct) return direct;
    const output = Array.isArray(root?.output) ? root.output : [];
    return output.flatMap((item) => {
      const content = Array.isArray(asRecord(item)?.content) ? asRecord(item)!.content as unknown[] : [];
      return content.map((part) => asString(asRecord(part)?.text)).filter(Boolean);
    }).join('\n');
  }
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const content = asRecord(asRecord(choices[0])?.message)?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content)
    ? content.map((part) => asString(asRecord(part)?.text)).filter(Boolean).join('\n')
    : '';
}

function usageFromPayload(payload: unknown, protocol: ApiSettings['protocol']) {
  const root = asRecord(payload);
  if (protocol === 'google-generate-content') {
    const usage = asRecord(root?.usageMetadata);
    return {
      promptTokens: Number(usage?.promptTokenCount) || 0,
      completionTokens: Number(usage?.candidatesTokenCount) || 0,
    };
  }
  const usage = asRecord(root?.usage);
  return {
    promptTokens: Number(usage?.prompt_tokens ?? usage?.input_tokens) || 0,
    completionTokens: Number(usage?.completion_tokens ?? usage?.output_tokens) || 0,
  };
}

function fill(current: string | null | undefined, generated: unknown) {
  return current?.trim() || asString(generated);
}

function mergeVisibleCharacter(
  current: NovelCastCharacter,
  payload: PortraitAnalysisPayload,
  target: CharacterPortraitAnalysisTarget,
): NovelCastCharacter {
  if (target === 'private') {
    const currentDossier = normalizeCharacterDossierV2(current.dossierV2, current);
    const mergedDossier = mergeCharacterDossierV2(
      current.dossierV2,
      payload.dossierV2,
      current,
      { includePrivate: true },
    );
    const dossierV2 = { ...mergedDossier, public: currentDossier.public };
    const withDossier = { ...current, dossierV2 };
    return {
      ...withDossier,
      aiSummary: normalizeCharacterAiSummary(
        current.aiSummary ?? payload.aiSummary,
        withDossier,
        dossierV2,
      ),
    };
  }

  const cast = asRecord(payload.cast) ?? {};
  const merged: NovelCastCharacter = {
    ...current,
    name: fill(current.name, cast.name),
    profession: fill(current.profession, cast.profession),
    age: fill(current.age, cast.age),
    gender: fill(current.gender, cast.gender),
    height: fill(current.height, cast.height),
    weight: fill(current.weight, cast.weight),
    birthplace: fill(current.birthplace, cast.birthplace),
    affiliation: fill(current.affiliation, cast.affiliation),
    appearance: fill(current.appearance, cast.appearance),
    personality: fill(current.personality, cast.personality),
    speechStyle: fill(current.speechStyle, cast.speechStyle),
    background: fill(current.background, cast.background),
    motive: fill(current.motive, cast.motive),
    strengths: fill(current.strengths, cast.strengths),
    weaknesses: fill(current.weaknesses, cast.weaknesses),
  };
  const dossierV2 = mergeCharacterDossierV2(
    current.dossierV2,
    payload.dossierV2,
    merged,
    { includePrivate: false },
  );
  const withDossier = { ...merged, dossierV2 };
  return {
    ...withDossier,
    aiSummary: normalizeCharacterAiSummary(
      current.aiSummary ?? payload.aiSummary,
      withDossier,
      dossierV2,
    ),
  };
}

export async function analyzeCharacterPortrait({
  apiSettings,
  imageUri,
  current,
  novelName,
  worldContext,
  userInstruction,
  nsfwEnabled = false,
  nsfwPrompt,
  target = 'public',
}: {
  apiSettings: ApiSettings;
  imageUri: string;
  current: NovelCastCharacter;
  novelName: string;
  worldContext?: string;
  userInstruction?: string;
  nsfwEnabled?: boolean;
  nsfwPrompt?: string;
  target?: CharacterPortraitAnalysisTarget;
}): Promise<CharacterPortraitAnalysisResult> {
  if (target === 'private' && !nsfwEnabled) {
    throw new Error('私密照识图仅在 NSFW 模式开启时可用。');
  }
  const image = await readNovelImageAsInlineData(imageUri);
  const model = apiSettings.model.trim();
  const protocol = apiSettings.protocol
    ?? (apiSettings.providerId === 'gemini' ? 'google-generate-content' : 'openai-compatible');
  const systemPrompt = buildCharacterPortraitAnalysisSystemPrompt(nsfwEnabled, nsfwPrompt, target);
  const contextText = [
    `小说：${novelName.trim() || '未命名'}`,
    worldContext?.trim() ? `世界设定：${worldContext.trim().slice(0, 2400)}` : '',
    `当前草稿：${JSON.stringify({
      name: current.name,
      profession: current.profession,
      age: current.age,
      gender: current.gender,
      height: current.height,
      weight: current.weight,
      birthplace: current.birthplace,
      affiliation: current.affiliation,
      appearance: current.appearance,
      personality: current.personality,
      speechStyle: current.speechStyle,
      background: current.background,
      motive: current.motive,
      dossierV2: target === 'private'
        ? current.dossierV2
        : current.dossierV2
          ? { ...current.dossierV2, private: null }
          : undefined,
    })}`,
    userInstruction?.trim() ? `作者补充：${userInstruction.trim()}` : '',
    target === 'private'
      ? '请按系统规则读取私密图片，只补全这一个虚构角色的私密档案。'
      : '请按系统规则读取日常图片，只补全这一个虚构角色的公开档案。',
  ].filter(Boolean).join('\n\n');

  let endpoint = '';
  let body: Record<string, unknown>;
  if (protocol === 'google-generate-content') {
    const root = resolveGeminiNativeRoot(apiSettings.baseUrl);
    endpoint = `${root}/models/${encodeURIComponent(normalizeGeminiModelId(model))}:generateContent`;
    if (apiSettings.apiKey.trim()) endpoint += `?key=${encodeURIComponent(apiSettings.apiKey.trim())}`;
    body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [
        { text: contextText },
        { inlineData: { mimeType: image.mimeType, data: image.base64 } },
      ] }],
      generationConfig: { temperature: 0.45, maxOutputTokens: 3600, responseMimeType: 'application/json' },
      safetySettings: geminiPermissiveSafetySettings(),
    };
  } else if (protocol === 'anthropic-messages') {
    endpoint = `${endpointRoot(apiSettings.baseUrl)}${/\/v1$/i.test(endpointRoot(apiSettings.baseUrl)) ? '' : '/v1'}/messages`;
    body = {
      model,
      system: systemPrompt,
      max_tokens: 3600,
      temperature: 0.45,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64 } },
        { type: 'text', text: contextText },
      ] }],
    };
  } else if (protocol === 'openai-responses') {
    endpoint = openAiEndpoint(apiSettings.baseUrl, 'responses');
    body = {
      model,
      instructions: systemPrompt,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: contextText },
        { type: 'input_image', image_url: image.dataUri },
      ] }],
      max_output_tokens: 3600,
    };
  } else {
    endpoint = openAiEndpoint(apiSettings.baseUrl, 'chat/completions');
    body = {
      model,
      temperature: 0.45,
      max_tokens: 3600,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'text', text: contextText },
          { type: 'image_url', image_url: { url: image.dataUri, detail: 'high' } },
        ] },
      ],
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.max(30_000, apiSettings.requestTimeoutMs));
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headersFor({ ...apiSettings, protocol }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let responsePayload: unknown;
    try { responsePayload = raw ? JSON.parse(raw) : null; } catch { responsePayload = null; }
    if (!response.ok) {
      const message = asString(asRecord(asRecord(responsePayload)?.error)?.message) || raw;
      throw new Error(message || `识图请求失败（HTTP ${response.status}）。`);
    }
    const modelText = responseText(responsePayload, protocol);
    const repairedResponse = await recoverStructuredResponse({ content: modelText, ...usageFromPayload(responsePayload, protocol) }, {
      signal: controller.signal,
      validate: (value) => {
        const record = asRecord(value);
        const dossier = asRecord(record.dossierV2);
        return Boolean(asRecord(record.cast).name && dossier.version === 2 && dossier.public && typeof dossier.public === 'object');
      },
      repair: async (repairPrompt, signal) => {
        const repairMessages = [
          { role: 'user', content: contextText },
          { role: 'assistant', content: modelText },
          { role: 'user', content: repairPrompt },
        ];
        let repairBody: Record<string, unknown>;
        if (protocol === 'google-generate-content') {
          repairBody = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: repairMessages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
            generationConfig: { temperature: 0.2, maxOutputTokens: 3600, responseMimeType: 'application/json' },
            safetySettings: geminiPermissiveSafetySettings(),
          };
        } else if (protocol === 'anthropic-messages') {
          repairBody = { model, system: systemPrompt, max_tokens: 3600, temperature: 0.2, messages: repairMessages.filter((message) => message.role !== 'system').map((message) => ({ role: message.role, content: message.content })) };
        } else if (protocol === 'openai-responses') {
          repairBody = { model, instructions: systemPrompt, input: repairMessages.map((message) => ({ role: message.role, content: [{ type: 'input_text', text: message.content }] })), max_output_tokens: 3600 };
        } else {
          repairBody = { model, temperature: 0.2, max_tokens: 3600, stream: false, messages: repairMessages };
        }
        const repairResponse = await fetch(endpoint, { method: 'POST', headers: headersFor({ ...apiSettings, protocol }), body: JSON.stringify(repairBody), signal });
        const repairRaw = await repairResponse.text();
        let repairPayload: unknown;
        try { repairPayload = repairRaw ? JSON.parse(repairRaw) : null; } catch { repairPayload = null; }
        if (!repairResponse.ok) throw new Error(`视觉 JSON 修复失败（HTTP ${repairResponse.status}）。`);
        return { content: responseText(repairPayload, protocol), ...usageFromPayload(repairPayload, protocol) };
      },
    });
    const parsed = extractJsonObject(repairedResponse.content);
    if (!parsed?.cast || !parsed.dossierV2) {
      throw new Error('视觉模型未返回可用的角色档案。');
    }
    const usage = { promptTokens: repairedResponse.promptTokens, completionTokens: repairedResponse.completionTokens };
    const character = mergeVisibleCharacter(current, parsed, target);
    return {
      character,
      target,
      changes: buildPortraitFieldProposals(current, character, parsed.fieldEvidence, target),
      ...usage,
      modelId: model,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('识图请求超时，请换用支持视觉的辅助模型后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

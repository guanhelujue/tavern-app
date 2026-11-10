import type { ImageApiSettings } from './image-generation';
import { generateImage } from './image-generation';
import { executeComfyWorkflow, uploadComfyImage, type ComfyWorkflow } from './comfyui-image-generation';
import { getComicPageLayout } from '../constants/novel-comic';
import { LOCAL_IMAGE_MODEL_IDS, type LocalImageModelId } from '../constants/image-models';
import type { ComicCharacter, ComicOutput, ComicPage, NovelComicDocument } from '../types/novel-comic';
import type { Novel } from '../types/tavern';
import { persistGeneratedImage } from '../utils/novel-images';
import { withImageRequestTrace } from './image-request-trace';

const activeDocuments = new Set<string>();

/** Use actual character-owned portraits and public appearance, never a placeholder or private dossier. */
export function collectComicCharacters(novel: Novel, content?: string): ComicCharacter[] {
  const cast = content ? novel.cast.filter((character) => [character.name, ...(character.aliases ?? [])]
    .some((name) => name.trim() && content.includes(name.trim()))) : novel.cast;
  return cast.slice(0, 12).map((character) => ({
    id: character.id, name: character.name,
    appearance: [character.gender, character.age && `${character.age}岁`, character.height, character.appearance].filter(Boolean).join('；'),
    // The planner may develop a visual outfit for new characters; existing
    // card appearance remains the authority when clothing is specified there.
    outfit: '', ...(character.portraitUri?.trim() ? { referenceImageUri: character.portraitUri.trim() } : {}),
  }));
}

function snapshot(document: NovelComicDocument): NovelComicDocument {
  return { ...document, characters: document.characters.map((character) => ({ ...character })),
    pages: document.pages.map((page) => ({ ...page, panels: page.panels.map((panel) => ({ ...panel,
      characterIds: [...panel.characterIds], dialogue: panel.dialogue.map((line) => ({ ...line })),
    })) })) };
}

function checkSignal(signal?: AbortSignal) {
  if (signal?.aborted) { const error = new Error('已停止；下次可继续生成未完成的图片。'); error.name = 'AbortError'; throw error; }
}

function annotatedOutput(output: ComicOutput) {
  const subfolder = output.subfolder.replace(/\\/g, '/');
  if (!['input', 'output', 'temp'].includes(output.type) || /[\\/\[\]:]/.test(output.filename)
    || subfolder.startsWith('/') || subfolder.split('/').includes('..')) {
    throw new Error('ComfyUI 返回了无效的图片文件引用。');
  }
  return `${subfolder ? `${subfolder}/` : ''}${output.filename} [${output.type}]`;
}

export function buildComicPageWorkflow(document: NovelComicDocument, page: ComicPage, imageNames: string[]): ComfyWorkflow {
  const layout = getComicPageLayout(page.layout);
  if (page.panels.length !== layout.panels.length || imageNames.length !== page.panels.length) {
    throw new Error('页面布局与分镜图片数量不一致。');
  }
  const graph: ComfyWorkflow = {
    '1': { class_type: 'TavernComicPage', inputs: {
      width: layout.width, height: layout.height,
      title: `${document.sourceTitle.slice(0, 40)} · 第 ${page.index + 1} 页`,
      layout_json: JSON.stringify({ panels: layout.panels.map((rect, index) => ({ ...rect,
        caption: page.panels[index].caption, dialogue: page.panels[index].dialogue,
      })) }),
    } },
    '90': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'Tavern/Comic/Pages' } },
  };
  imageNames.forEach((image, index) => {
    const id = String(index + 11);
    graph[id] = { class_type: 'LoadImage', inputs: { image } };
    graph['1'].inputs[`image_${index + 1}`] = [id, 0];
  });
  return graph;
}

export async function generateNovelComicImages({ document: original, apiSettings, signal, onUpdate, onProgress,
  onlyPanelId, fetchImpl = globalThis.fetch,
}: {
  document: NovelComicDocument;
  apiSettings: ImageApiSettings;
  signal?: AbortSignal;
  onUpdate?: (document: NovelComicDocument) => void | Promise<void>;
  onProgress?: (message: string) => void;
  onlyPanelId?: string;
  fetchImpl?: typeof fetch;
}): Promise<NovelComicDocument> {
  if (activeDocuments.has(original.id)) throw new Error('这份分镜正在生成，请等待当前任务结束。');
  if (!LOCAL_IMAGE_MODEL_IDS.includes(original.modelId as LocalImageModelId)) throw new Error('请选择 Qwen Image 2.1、MOSS 或 Z-Image。');
  if (apiSettings.protocol && !['auto', 'comfyui'].includes(apiSettings.protocol)) throw new Error('正文分镜需要连接本地 ComfyUI。');
  const document = snapshot(original);
  const affectedPages = onlyPanelId ? document.pages.filter((page) => page.panels.some((panel) => panel.id === onlyPanelId)) : document.pages;
  if (!affectedPages.length) throw new Error('未找到需要生成的分镜。');
  const checkpoint = async () => { document.updatedAt = new Date().toISOString(); await onUpdate?.(snapshot(document)); };
  const report = (message: string) => onProgress?.(message);
  const comfySettings = { ...apiSettings, protocol: 'comfyui' as const };
  activeDocuments.add(original.id);
  try {
    checkSignal(signal);
    document.status = 'generating'; document.error = undefined;
    if (onlyPanelId) {
      const page = affectedPages[0];
      const panel = page.panels.find((item) => item.id === onlyPanelId)!;
      panel.status = 'pending'; panel.error = undefined; panel.imageUri = undefined;
      panel.comfyPromptId = undefined; panel.comfyOutput = undefined;
      panel.seed = Math.floor(Math.random() * 2 ** 48);
      page.status = 'pending'; page.imageUri = undefined; page.comfyPromptId = undefined; page.comfyOutput = undefined;
    }
    await checkpoint();
    const neededIds = new Set(affectedPages.flatMap((page) => page.panels
      .filter((panel) => !onlyPanelId || panel.id === onlyPanelId).flatMap((panel) => panel.characterIds)));
    const characters = document.characters.filter((character) => neededIds.has(character.id));
    for (const character of characters) {
      if (character.referenceImageUri) continue;
      checkSignal(signal);
      report(`生成角色原图：${character.name}（768×1024）`);
      try {
        const result = await generateImage({ apiSettings: comfySettings, purpose: 'portrait',
          model: document.modelId, width: 768, height: 1024, fetchImpl, signal,
          resumePromptId: character.referenceComfyPromptId,
          prompt: `A photorealistic identity reference photograph of one person. Character: ${character.name}. Appearance: ${character.appearance}. Outfit: ${character.outfit || 'ordinary fully clothed attire appropriate to the described setting'}. Neutral relaxed standing pose, head and torso clearly visible, both eyes visible, natural skin texture, soft neutral daylight, simple unobtrusive background. One person, no collage, no text, no drawing or anime style.`,
          onSubmitted: async (promptId) => { character.referenceComfyPromptId = promptId; await checkpoint(); },
        });
        character.referenceImageUri = result.uri; character.referenceComfyPromptId = undefined;
        await checkpoint();
      } catch (error) {
        if (error instanceof Error && error.name === 'ComfyExecutionError') character.referenceComfyPromptId = undefined;
        throw error;
      }
    }
    for (const page of affectedPages) {
      for (const panel of page.panels) {
        if (onlyPanelId && panel.id !== onlyPanelId) continue;
        if (panel.status === 'completed' && panel.imageUri) continue;
        checkSignal(signal);
        const references = panel.characterIds.map((id) => document.characters.find((character) => character.id === id));
        if (references.some((character) => !character?.referenceImageUri)) throw new Error(`第 ${page.index + 1} 页存在缺少原图的角色。`);
        const mapping = references.map((character, index) => `Reference image ${index + 1} is ${character!.name}; preserve this person's facial identity and physical appearance.`).join(' ');
        const prompt = document.modelId === 'qwen-image-2.1' && references.length
          ? `${mapping} Create a new live-action photograph following this target shot, changing pose and framing as needed: ${panel.prompt}` : panel.prompt;
        report(`第 ${page.index + 1} 页 · 第 ${panel.index + 1} 幕（${panel.width}×${panel.height}）`);
        page.imageUri = undefined; page.comfyPromptId = undefined; page.comfyOutput = undefined; page.status = 'pending';
        panel.error = undefined;
        try {
          const result = await generateImage({ apiSettings: comfySettings, purpose: 'scene', model: document.modelId,
            prompt, negativePrompt: panel.negativePrompt, width: panel.width, height: panel.height, seed: panel.seed,
            referenceImageUris: references.map((character) => character!.referenceImageUri!), fetchImpl, signal,
            resumePromptId: panel.comfyPromptId,
            onSubmitted: async (promptId) => { panel.comfyPromptId = promptId; panel.status = 'queued'; await checkpoint(); },
            onProgress: (progress) => report(`第 ${page.index + 1} 页 · 第 ${panel.index + 1} 幕：${progress.message ?? progress.phase}`),
          });
          panel.imageUri = result.uri; panel.comfyOutput = result.comfyOutput; panel.comfyPromptId = result.promptId;
          panel.status = 'completed'; await checkpoint();
        } catch (error) {
          panel.status = 'error'; panel.error = error instanceof Error ? error.message : String(error);
          if (error instanceof Error && error.name === 'ComfyExecutionError') panel.comfyPromptId = undefined;
          await checkpoint(); throw error;
        }
      }
      if (page.panels.some((panel) => !panel.imageUri || panel.status !== 'completed')) continue;
      if (page.status === 'completed' && page.imageUri) continue;
      checkSignal(signal);
      report(`拼合第 ${page.index + 1} 页（1536×2304），排入中文旁白与对白`);
      await withImageRequestTrace(comfySettings, 'ComfyUI · TavernComicPage', 'comic-page',
        `拼合第 ${page.index + 1} 页：${document.sourceTitle}`, async (debugTrace) => {
          const pageSettings = { ...comfySettings, debugTrace };
          try {
            const imageNames: string[] = [];
            for (const panel of page.panels) {
              imageNames.push(panel.comfyOutput ? annotatedOutput(panel.comfyOutput)
                : await uploadComfyImage(panel.imageUri!, pageSettings, fetchImpl, signal));
            }
            const result = await executeComfyWorkflow({ apiSettings: pageSettings, graph: buildComicPageWorkflow(document, page, imageNames),
              resumePromptId: page.comfyPromptId, fetchImpl, signal,
              onSubmitted: async (promptId) => { page.comfyPromptId = promptId; page.status = 'queued'; await checkpoint(); },
            });
            debugTrace?.progress('保存漫画页面', result.promptId);
            page.imageUri = await persistGeneratedImage(result.source, 'scene'); page.comfyOutput = result.output;
            page.comfyPromptId = result.promptId; page.status = 'completed'; page.error = undefined;
            await checkpoint();
            return { uri: page.imageUri, promptId: result.promptId, output: result.output };
          } catch (error) {
            page.status = 'error'; page.error = error instanceof Error ? error.message : String(error);
            if (error instanceof Error && error.name === 'ComfyExecutionError') page.comfyPromptId = undefined;
            await checkpoint(); throw error;
          }
        });
    }
    document.status = document.pages.every((page) => page.status === 'completed') ? 'completed' : 'planned';
    await checkpoint(); return snapshot(document);
  } catch (error) {
    document.status = 'error'; document.error = error instanceof Error ? error.message : String(error);
    await checkpoint(); throw error;
  } finally { activeDocuments.delete(original.id); }
}

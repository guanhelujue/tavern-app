import type { ApiSettings, ContentStyleSettings, Novel, NovelChapter } from '@/types/tavern';
import { resolveNovelSystemPrompt } from '@/constants/novel-memory';
import { requestPlainCompletion } from '@/services/llm';
import { buildNovelCharacterContext } from '@/utils/novel-narrative-context';
import { buildChapterInstruction } from '@/utils/novel-chapter-planning';
import { buildWritingPromptExtensionBlocks } from '@/utils/writing-prompt-extensions';
import { assertChapterLength, parseChapterTargetWords } from '@/utils/novel-chapter-length';

export type ChapterRewriteMode = 'polish' | 'edit' | 'rewrite';

const MODE_INSTRUCTIONS: Record<ChapterRewriteMode, string> = {
  polish: '润色文字：保留全部情节、人物决定、事实和结尾，只改语言、重复与表达。',
  edit: '按意见修改：落实作者指定的改动，保留不相关的原文与情节。',
  rewrite: '整章重写：允许重新组织场景与叙事，按当前设定和作者新要求完整重写本章。旧正文是参考，不是必须沿用的事实。',
};

/** Produces a reviewable candidate only. Adoption is a separate, version-checked action. */
export async function requestChapterRewrite({ novel, chapter, apiSettings, instruction, mode, writingExtensions }: {
  novel: Novel; chapter: NovelChapter; apiSettings: ApiSettings;
  instruction: string; mode: ChapterRewriteMode; writingExtensions?: Partial<ContentStyleSettings>;
}): Promise<string> {
  if (!chapter.content.trim() || (chapter.contentStatus && chapter.contentStatus !== 'loaded')) {
    throw new Error('请先加载并保存本章正文，再生成修改候选。');
  }
  const previous = (novel.chapters ?? []).filter((item) => item.status === 'final' && item.index < chapter.index)
    .sort((a, b) => a.index - b.index).slice(-3);
  if (previous.some((item) => item.contentStatus && item.contentStatus !== 'loaded')) {
    throw new Error('前文尚未加载完成，请稍后重试。');
  }
  const earlier = previous.map((item) => `第${item.index}章 ${item.title}\n${item.summary || ''}\n${item.content.slice(-2500)}`).join('\n\n');
  const request = `第${chapter.index}章 ${chapter.title}\n${buildChapterInstruction(chapter.goal, chapter.planning)}\n${instruction}`;
  const result = await requestPlainCompletion({
    apiSettings,
    purpose: 'chapter-rewrite-candidate',
    messages: [
      { role: 'system', content: [
        `【小说主提示词】\n${resolveNovelSystemPrompt(novel.systemPrompt)}`,
        '【本次任务：修改当前章节】\n遵循小说主提示词及作者本章要求的视角、文风和输出格式，返回本章的完整新版正文，不接写下一章。以下设定与写作风格扩展作为补充，不覆盖小说主提示词和作者明确要求。',
        MODE_INSTRUCTIONS[mode],
        buildNovelCharacterContext(novel, request, earlier),
        ...buildWritingPromptExtensionBlocks(writingExtensions),
      ].filter(Boolean).join('\n\n') },
      { role: 'user', content: `【此前已定稿剧情】\n${earlier || '这是首章。'}\n\n【本章与作者要求】\n${request}\n\n【待修改原稿】\n${chapter.content}` },
    ],
  });
  const candidate = result.trim();
  if (!candidate) throw new Error('模型没有返回重写内容，原稿已保留。');
  assertChapterLength(candidate, parseChapterTargetWords(instruction) ?? chapter.targetWords);
  return candidate;
}

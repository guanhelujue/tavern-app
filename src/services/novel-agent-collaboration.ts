import type { NovelCharacterBrief, NovelDirectPlan } from '@/types/tavern';

export type NovelAgentResult<T> = { value: T; tokens: number; model?: string };

export type NovelAgentCollaborationResult = {
  directPlan?: NovelDirectPlan;
  characterBrief?: NovelCharacterBrief;
  directTokens?: number;
  characterTokens?: number;
  directError?: unknown;
  characterError?: unknown;
};

export function isAbortLike(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

/** Starts both independent preflight agents in the same wave and waits for both. */
export async function runNovelAgentCollaboration({
  runDirect,
  runCharacter,
  hasCharacter,
}: {
  runDirect: () => Promise<NovelAgentResult<NovelDirectPlan>>;
  runCharacter?: () => Promise<NovelAgentResult<NovelCharacterBrief>>;
  hasCharacter: boolean;
}): Promise<NovelAgentCollaborationResult> {
  const directPromise = runDirect();
  const characterPromise = hasCharacter && runCharacter ? runCharacter() : undefined;
  const [direct, character] = await Promise.all([
    directPromise.then((value) => ({ status: 'fulfilled' as const, value }), (reason) => ({ status: 'rejected' as const, reason })),
    characterPromise
      ? characterPromise.then((value) => ({ status: 'fulfilled' as const, value }), (reason) => ({ status: 'rejected' as const, reason }))
      : Promise.resolve({ status: 'fulfilled' as const, value: undefined }),
  ]);

  const errors = [direct, character].filter(
    (result): result is { status: 'rejected'; reason: unknown } => result.status === 'rejected',
  );
  const abort = errors.find((result) => isAbortLike(result.reason));
  if (abort) throw abort.reason;

  return {
    directPlan: direct.status === 'fulfilled' ? direct.value.value : undefined,
    characterBrief: character.status === 'fulfilled' ? character.value?.value : undefined,
    directTokens: direct.status === 'fulfilled' ? direct.value.tokens : undefined,
    characterTokens: character.status === 'fulfilled' ? character.value?.tokens : undefined,
    directError: direct.status === 'rejected' ? direct.reason : undefined,
    characterError: character.status === 'rejected' ? character.reason : undefined,
  };
}

export function buildNovelAgentHandoff({
  directPlan,
  characterBrief,
}: Pick<NovelAgentCollaborationResult, 'directPlan' | 'characterBrief'>): string {
  const sections = [
    directPlan ? `<DIRECT_PLAN>\n${JSON.stringify(directPlan)}\n</DIRECT_PLAN>` : '',
    characterBrief ? `<CHARACTER_BRIEF>\n${JSON.stringify(characterBrief)}\n</CHARACTER_BRIEF>` : '',
  ].filter(Boolean);
  if (!sections.length) return '';
  return [
    '以下是本回合的协作资料：它们不是历史记录，也不是候选正文，不得照抄。',
    ...sections,
    '冲突优先级：用户指令与正史 > Direct 管剧情 > Character 管角色。',
    '你是 Narrator，只输出合成后的自然正文，不提及任何 Agent、标签或协作过程。',
  ].join('\n\n');
}

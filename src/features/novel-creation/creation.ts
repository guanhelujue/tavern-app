import {
  createEmptyBlueprint,
  createEmptyCreationSession,
  type CreationEvent,
  type CreationSession,
  type StoryBlueprint,
  validateBlueprint,
} from './domain';

export type CreationDraftPort = {
  load(): Promise<CreationSession | null>;
  save(session: CreationSession): Promise<void>;
  clear(): Promise<void>;
};

export type BlueprintGeneratorPort = (seed: string) => Promise<StoryBlueprint[]>;
export type NovelCommitPort = (blueprint: StoryBlueprint) => Promise<string> | string;

export type NovelCreation = {
  open(): Promise<CreationSession>;
  saveDraft(session: CreationSession): Promise<CreationSession>;
  transition(session: CreationSession, event: CreationEvent): Promise<CreationSession>;
  commit(session: CreationSession): Promise<string>;
};

export type CreationEditEvent = Extract<CreationEvent, { type: 'edit-seed' | 'edit-blueprint' }>;

function nextSession(session: CreationSession, updates: Partial<CreationSession>): CreationSession {
  return {
    ...session,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

export function applyCreationEdit(session: CreationSession, event: CreationEditEvent): CreationSession {
  if (event.type === 'edit-seed') {
    return nextSession(session, { seed: event.seed, error: undefined });
  }
  if (!session.blueprint) {
    return nextSession(session, { error: '请先选择或建立一个故事蓝图。' });
  }
  return nextSession(session, {
    blueprint: {
      ...session.blueprint,
      ...event.patch,
      protagonist: {
        ...session.blueprint.protagonist,
        ...(event.patch.protagonist ?? {}),
      },
    },
    error: undefined,
  });
}

export function createNovelCreation({
  drafts,
  generateBlueprints,
  commitNovel,
}: {
  drafts: CreationDraftPort;
  generateBlueprints: BlueprintGeneratorPort;
  commitNovel: NovelCommitPort;
}): NovelCreation {
  async function persist(session: CreationSession) {
    try {
      await drafts.save(session);
      return session;
    } catch {
      return {
        ...session,
        error: '当前修改已保留在页面中，但自动保存失败。请暂时不要退出。',
      };
    }
  }

  return {
    async open() {
      return (await drafts.load()) ?? createEmptyCreationSession();
    },

    saveDraft: persist,

    async transition(session, event) {
      if (event.type === 'edit-seed' || event.type === 'edit-blueprint') {
        return persist(applyCreationEdit(session, event));
      }
      if (event.type === 'generate-ideas') {
        try {
          const proposals = await generateBlueprints(session.seed);
          if (proposals.length === 0) throw new Error('没有生成可用的故事方案。');
          return persist(nextSession(session, {
            step: 'ideas',
            proposals: proposals.slice(0, 3),
            blueprint: undefined,
            error: undefined,
          }));
        } catch (error) {
          return persist(nextSession(session, {
            error: error instanceof Error ? error.message : '灵感生成失败，请稍后重试。',
          }));
        }
      }
      if (event.type === 'choose-idea') {
        const blueprint = session.proposals.find((item) => item.id === event.id);
        if (!blueprint) return persist(nextSession(session, { error: '找不到这个故事方案，请重新生成。' }));
        return persist(nextSession(session, { step: 'blueprint', blueprint, error: undefined }));
      }
      if (event.type === 'start-blank') {
        return persist(nextSession(session, {
          step: 'blueprint',
          blueprint: createEmptyBlueprint(session.seed),
          proposals: [],
          error: undefined,
        }));
      }
      if (event.type === 'back-to-seed') {
        return persist(nextSession(session, { step: 'seed', blueprint: undefined, error: undefined }));
      }

      const empty = createEmptyCreationSession();
      await drafts.clear();
      return empty;
    },

    async commit(session) {
      if (!session.blueprint) throw new Error('请先完成故事蓝图。');
      const missing = validateBlueprint(session.blueprint);
      if (missing.length > 0) throw new Error(`请补全：${missing.join('、')}。`);
      const novelId = await commitNovel(session.blueprint);
      try {
        await drafts.clear();
      } catch {
        // The novel already exists. Draft cleanup must not turn a successful
        // commit into a user-visible creation failure.
      }
      return novelId;
    },
  };
}

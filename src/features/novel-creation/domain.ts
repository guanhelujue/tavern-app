export type StoryProtagonist = {
  identity: string;
  desire: string;
  obstacle: string;
};

export type StoryLongForm = {
  /** Renewable source of conflict that can keep producing consequential choices. */
  engine: string;
  /** Three to five volume-scale stages, each with escalation and a turn. */
  arcs: string[];
  /** Independent questions/relationships/problems that mature at different speeds. */
  openThreads: string[];
};

export type StoryBlueprint = {
  id: string;
  title: string;
  premise: string;
  protagonist: StoryProtagonist;
  setting: string;
  stakes: string;
  opening: string;
  direction: string;
  tone: string;
  constraints: string[];
  longForm: StoryLongForm;
};

export type CreationSession = {
  version: 1;
  id: string;
  seed: string;
  step: 'seed' | 'ideas' | 'blueprint';
  proposals: StoryBlueprint[];
  blueprint?: StoryBlueprint;
  error?: string;
  updatedAt: string;
};

export type CreationEvent =
  | { type: 'edit-seed'; seed: string }
  | { type: 'generate-ideas' }
  | { type: 'choose-idea'; id: string }
  | { type: 'start-blank' }
  | { type: 'edit-blueprint'; patch: Partial<Omit<StoryBlueprint, 'protagonist'>> & { protagonist?: Partial<StoryProtagonist> } }
  | { type: 'back-to-seed' }
  | { type: 'restart' };

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyBlueprint(seed = ''): StoryBlueprint {
  return {
    id: makeId('blueprint'),
    title: '',
    premise: seed.trim(),
    protagonist: { identity: '', desire: '', obstacle: '' },
    setting: '',
    stakes: '',
    opening: '',
    direction: '',
    tone: '',
    constraints: [],
    longForm: { engine: '', arcs: [], openThreads: [] },
  };
}

export function createEmptyCreationSession(): CreationSession {
  return {
    version: 1,
    id: makeId('creation'),
    seed: '',
    step: 'seed',
    proposals: [],
    updatedAt: new Date().toISOString(),
  };
}

export function validateBlueprint(blueprint: StoryBlueprint): string[] {
  const missing: string[] = [];
  if (!blueprint.title.trim()) missing.push('书名');
  if (!blueprint.premise.trim()) missing.push('故事前提');
  if (!blueprint.protagonist.desire.trim()) missing.push('主角欲望');
  if (!blueprint.protagonist.obstacle.trim()) missing.push('核心阻力');
  if (!blueprint.opening.trim()) missing.push('开篇场景');
  if (!blueprint.longForm.engine.trim()) missing.push('长篇故事引擎');
  if (blueprint.longForm.arcs.filter((item) => item.trim()).length < 3) missing.push('至少三个阶段推进');
  if (blueprint.longForm.openThreads.filter((item) => item.trim()).length < 3) missing.push('至少三条长期悬念');
  return missing;
}

function normalizeBlueprint(value: StoryBlueprint | undefined): StoryBlueprint | undefined {
  if (!value) return undefined;
  const longForm = value.longForm && typeof value.longForm === 'object'
    ? value.longForm
    : { engine: '', arcs: [], openThreads: [] };
  return {
    ...value,
    constraints: Array.isArray(value.constraints) ? value.constraints : [],
    longForm: {
      engine: typeof longForm.engine === 'string' ? longForm.engine : '',
      arcs: Array.isArray(longForm.arcs) ? longForm.arcs : [],
      openThreads: Array.isArray(longForm.openThreads) ? longForm.openThreads : [],
    },
  };
}

function hasRequiredLongForm(blueprint: StoryBlueprint) {
  return Boolean(
    blueprint.longForm.engine.trim()
    && blueprint.longForm.arcs.filter((item) => item.trim()).length >= 3
    && blueprint.longForm.openThreads.filter((item) => item.trim()).length >= 3,
  );
}

export function normalizeCreationSession(value: unknown): CreationSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<CreationSession>;
  if (raw.version !== 1 || typeof raw.id !== 'string' || typeof raw.seed !== 'string') return null;
  if (raw.step !== 'seed' && raw.step !== 'ideas' && raw.step !== 'blueprint') return null;
  const proposals = Array.isArray(raw.proposals)
    ? raw.proposals.map((item) => normalizeBlueprint(item)).filter((item): item is StoryBlueprint => Boolean(item))
    : [];
  const usableProposals = proposals.filter(hasRequiredLongForm);
  const staleIdeaDraft = raw.step === 'ideas' && usableProposals.length === 0;
  return {
    version: 1,
    id: raw.id,
    seed: raw.seed,
    step: staleIdeaDraft ? 'seed' : raw.step,
    proposals: staleIdeaDraft ? [] : usableProposals,
    blueprint: normalizeBlueprint(raw.blueprint),
    error: staleIdeaDraft
      ? '旧灵感方案缺少长篇结构，请重新生成一批。'
      : typeof raw.error === 'string' ? raw.error : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

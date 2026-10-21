import type { Novel, NovelCastCharacter, NovelCharacterDossier, WorldbookEntry } from '@/types/tavern';
import {
  formatCharacterAiSummaryForPrompt,
  normalizeCharacterAiSummary,
} from '@/features/character-dossier-v2/ai-summary';
import { normalizeCharacterDossierV2 } from '@/features/character-dossier-v2/model';
import {
  formatCastRelationsForInject,
  parseRelationsBlockFromContent,
} from '@/utils/novel-relations';
import { asString, normalizeAliases } from '@/utils/helpers';


function mergeLegacyGenitalsText(options: {
  genitals?: string;
  genitalia?: string;
  penis?: string;
  clitoris?: string;
}): string {
  const existing = options.genitals?.trim() || options.genitalia?.trim() || '';
  if (existing) {
    return existing;
  }

  const penis = options.penis?.trim() ?? '';
  const clitoris = options.clitoris?.trim() ?? '';
  if (penis && clitoris) {
    return `${penis}；${clitoris}`;
  }
  return penis || clitoris;
}

/** Normalize / migrate cast privacy: merge legacy penis/clitoris into genitals. */
export function normalizeCastPrivacyFields(
  privacy: NovelCastCharacter['privacy'] | Record<string, unknown> | null | undefined,
): NovelCastCharacter['privacy'] | undefined {
  if (!privacy || typeof privacy !== 'object') {
    return undefined;
  }

  const record = privacy as Record<string, unknown>;
  const genitals = mergeLegacyGenitalsText({
    genitals: typeof record.genitals === 'string' ? record.genitals : undefined,
    genitalia: typeof record.genitalia === 'string' ? record.genitalia : undefined,
    penis: typeof record.penis === 'string' ? record.penis : undefined,
    clitoris: typeof record.clitoris === 'string' ? record.clitoris : undefined,
  });
  const chest = asString(record.chest);
  const erogenousZones = asString(record.erogenousZones);
  const scent = asString(record.scent);
  const xp = asString(record.xp);
  const masturbationHabits = asString(record.masturbationHabits);
  const taboo = asString(record.taboo);

  if (
    !genitals &&
    !chest &&
    !erogenousZones &&
    !scent &&
    !xp &&
    !masturbationHabits &&
    !taboo
  ) {
    return undefined;
  }

  return {
    ...(genitals ? { genitals } : {}),
    ...(chest ? { chest } : {}),
    ...(erogenousZones ? { erogenousZones } : {}),
    ...(scent ? { scent } : {}),
    ...(xp ? { xp } : {}),
    ...(masturbationHabits ? { masturbationHabits } : {}),
    ...(taboo ? { taboo } : {}),
  };
}

export function formatCastPrivacyLines(privacy: NovelCastCharacter['privacy'] | null | undefined) {
  if (!privacy) {
    return [] as string[];
  }

  const genitals = privacy.genitals?.trim() ?? '';
  const chest = privacy.chest?.trim() ?? '';
  const erogenousZones = privacy.erogenousZones?.trim() ?? '';
  const scent = privacy.scent?.trim() ?? '';
  const xp = privacy.xp?.trim() ?? '';
  const masturbationHabits = privacy.masturbationHabits?.trim() ?? '';
  const taboo = privacy.taboo?.trim() ?? '';

  return [
    genitals ? `性器官：${genitals}` : '',
    chest ? `胸部：${chest}` : '',
    erogenousZones ? `敏感带：${erogenousZones}` : '',
    scent ? `气味：${scent}` : '',
    xp ? `性癖：${xp}` : '',
    masturbationHabits ? `自慰习惯：${masturbationHabits}` : '',
    taboo ? `禁忌：${taboo}` : '',
  ].filter(Boolean);
}


export function contentFromCast(character: NovelCastCharacter) {
  if (character.aiSummary && character.dossierV2) {
    const dossier = normalizeCharacterDossierV2(character.dossierV2, character);
    return formatCharacterAiSummaryForPrompt(
      normalizeCharacterAiSummary(character.aiSummary, character, dossier),
      { includePrivate: true },
    );
  }
  const height = character.height?.trim() ?? '';
  const weight = character.weight?.trim() ?? '';

  return [
    character.name.trim() ? `姓名：${character.name.trim()}` : '',
    character.isProtagonist ? '身份：主角' : '',
    character.profession.trim() ? `职业：${character.profession.trim()}` : '',
    character.age.trim() ? `年龄：${character.age.trim()}` : '',
    character.gender.trim() ? `性别：${character.gender.trim()}` : '',
    height ? `身高：${height}` : '',
    weight ? `体重：${weight}` : '',
    character.birthplace?.trim() ? `出生地：${character.birthplace.trim()}` : '',
    character.affiliation?.trim() ? `阵营所属：${character.affiliation.trim()}` : '',
    character.appearance.trim() ? `外貌：${character.appearance.trim()}` : '',
    character.personality.trim() ? `性格：${character.personality.trim()}` : '',
    character.speechStyle.trim() ? `语气：${character.speechStyle.trim()}` : '',
    character.background.trim() ? `背景：${character.background.trim()}` : '',
    character.motive?.trim() ? `动机：${character.motive.trim()}` : '',
    character.strengths?.trim() ? `优势：${character.strengths.trim()}` : '',
    character.weaknesses?.trim() ? `软肋：${character.weaknesses.trim()}` : '',
    formatCastRelationsForInject(character.relations),
    ...formatCastPrivacyLines(character.privacy),
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeAliasesForDossier(value: unknown, name: string): string[] {
  const nameKey = name.trim().toLowerCase();
  return normalizeAliases(value).filter((alias) => alias.toLowerCase() !== nameKey);
}

type LegacyDossier = Partial<NovelCharacterDossier> & { profile?: string };

/** Settings body only — never pull experience into content. */
function resolveDossierContent(item: LegacyDossier): string {
  if (typeof item.content === 'string' && item.content.trim()) {
    return item.content.trim();
  }

  return item.profile?.trim() ?? '';
}

function resolveDossierExperience(item: LegacyDossier): string {
  return typeof item.experience === 'string' ? item.experience.trim() : '';
}

function resolveDossierExperienceDraft(item: LegacyDossier): string {
  return typeof item.experienceDraft === 'string' ? item.experienceDraft.trim() : '';
}

export function normalizeCharacterDossier(
  item: LegacyDossier | null | undefined,
  index = 0,
): NovelCharacterDossier {
  const timestamp = new Date().toISOString();
  const name = item?.name?.trim() ?? '';

  return {
    id:
      typeof item?.id === 'string' && item.id.trim()
        ? item.id.trim()
        : `dossier-${index}-${Date.now()}`,
    castId: item?.castId?.trim() || undefined,
    name,
    aliases: normalizeAliasesForDossier(item?.aliases, name),
    content: resolveDossierContent(item ?? {}),
    experience: resolveDossierExperience(item ?? {}),
    experienceDraft: resolveDossierExperienceDraft(item ?? {}),
    enabled: item?.enabled !== false,
    ...(item?.stale === true ? { stale: true } : {}),
    updatedAt: item?.updatedAt?.trim() || timestamp,
  };
}

export function dossierFromCast(character: NovelCastCharacter): NovelCharacterDossier {
  return {
    id: `dossier-${character.id}`,
    castId: character.id,
    name: character.name.trim(),
    aliases: normalizeAliasesForDossier(character.aliases, character.name),
    content: contentFromCast(character),
    experience: '',
    experienceDraft: '',
    enabled: true,
    updatedAt: new Date().toISOString(),
  };
}

function parseLabeledField(content: string, label: string) {
  const match = content.match(new RegExp(`${label}[：:]\\s*([^\\n]+)`));
  return match?.[1]?.trim() ?? '';
}

function parsePrivacyFromContent(content: string): NovelCastCharacter['privacy'] | undefined {
  return normalizeCastPrivacyFields({
    genitals:
      parseLabeledField(content, '性器官') || parseLabeledField(content, '生殖器'),
    penis: parseLabeledField(content, '阴茎'),
    clitoris: parseLabeledField(content, '阴蒂'),
    chest: parseLabeledField(content, '胸部'),
    erogenousZones: parseLabeledField(content, '敏感带'),
    scent: parseLabeledField(content, '气味'),
    xp: parseLabeledField(content, '性癖') || parseLabeledField(content, 'XP'),
    masturbationHabits: parseLabeledField(content, '自慰习惯'),
    taboo: parseLabeledField(content, '禁忌') || parseLabeledField(content, '雷点'),
  });
}

/** Rebuild structured cast fields from a knowledge entry (for the add/edit modal). */
export function castFromDossier(
  dossier: NovelCharacterDossier,
  fallbackId?: string,
  existingCast?: NovelCastCharacter | null,
): NovelCastCharacter {
  const content = dossier.content ?? '';
  const privacy = parsePrivacyFromContent(content);
  const isProtagonist =
    existingCast?.isProtagonist === true || parseLabeledField(content, '身份') === '主角';
  const fromContentRelations = parseRelationsBlockFromContent(content);
  const relations =
    existingCast?.relations?.length
      ? existingCast.relations
      : fromContentRelations.length
        ? fromContentRelations
        : undefined;

  return {
    id: dossier.castId || fallbackId || existingCast?.id || `cast-${dossier.id}`,
    name: dossier.name.trim() || parseLabeledField(content, '姓名'),
    aliases: normalizeAliasesForDossier(dossier.aliases, dossier.name),
    profession: parseLabeledField(content, '职业') || existingCast?.profession || '',
    age: parseLabeledField(content, '年龄') || existingCast?.age || '',
    gender: parseLabeledField(content, '性别') || existingCast?.gender || '',
    height: parseLabeledField(content, '身高') || existingCast?.height || '',
    weight: parseLabeledField(content, '体重') || existingCast?.weight || '',
    birthplace:
      parseLabeledField(content, '出生地') ||
      parseLabeledField(content, '籍贯') ||
      existingCast?.birthplace ||
      '',
    affiliation:
      parseLabeledField(content, '阵营所属') ||
      parseLabeledField(content, '阵营') ||
      existingCast?.affiliation ||
      '',
    appearance: parseLabeledField(content, '外貌') || existingCast?.appearance || '',
    personality: parseLabeledField(content, '性格') || existingCast?.personality || '',
    speechStyle: parseLabeledField(content, '语气') || existingCast?.speechStyle || '',
    background: parseLabeledField(content, '背景') || existingCast?.background || '',
    isProtagonist,
    motive: parseLabeledField(content, '动机') || existingCast?.motive || '',
    strengths: parseLabeledField(content, '优势') || existingCast?.strengths || '',
    weaknesses: parseLabeledField(content, '软肋') || existingCast?.weaknesses || '',
    ...(relations ? { relations } : {}),
    ...(privacy ? { privacy } : existingCast?.privacy ? { privacy: existingCast.privacy } : {}),
    ...(existingCast?.generatedFromReply === true ? { generatedFromReply: true as const } : {}),
    // 立绘只存在 cast 上，dossier content 不含图片；必须从 linked cast 带回
    ...(existingCast?.portraitUri?.trim()
      ? { portraitUri: existingCast.portraitUri.trim() }
      : {}),
    ...(existingCast?.portraitFocus ? { portraitFocus: existingCast.portraitFocus } : {}),
    ...(existingCast?.dossierV2 ? { dossierV2: existingCast.dossierV2 } : {}),
    ...(existingCast?.aiSummary ? { aiSummary: existingCast.aiSummary } : {}),
  };
}

/**
 * Merge cast cards into knowledge entries.
 * When `refreshContentFromCast` is true, linked entries always take content from cast fields
 * (used after editing via the character modal). Experience + draft are always preserved.
 */
export function syncDossiersWithCast(
  cast: NovelCastCharacter[],
  dossiers: NovelCharacterDossier[],
  options?: { refreshContentFromCast?: boolean },
): NovelCharacterDossier[] {
  const refreshContentFromCast = options?.refreshContentFromCast === true;
  const byCastId = new Map(
    dossiers.filter((item) => item.castId).map((item) => [item.castId!, item]),
  );
  const byName = new Map(
    dossiers
      .filter((item) => item.name.trim())
      .map((item) => [item.name.trim().toLowerCase(), item]),
  );
  const used = new Set<string>();
  const next: NovelCharacterDossier[] = [];
  const timestamp = new Date().toISOString();

  for (const character of cast) {
    const nameKey = character.name.trim().toLowerCase();
    const existing =
      (character.id ? byCastId.get(character.id) : undefined) ||
      (nameKey ? byName.get(nameKey) : undefined);

    if (existing) {
      used.add(existing.id);
      next.push({
        ...existing,
        castId: character.id,
        name: character.name.trim() || existing.name,
        aliases: normalizeAliasesForDossier(
          character.aliases,
          character.name.trim() || existing.name,
        ),
        content: refreshContentFromCast
          ? contentFromCast(character)
          : existing.content.trim() || contentFromCast(character),
        experience: existing.experience?.trim() ?? '',
        experienceDraft: existing.experienceDraft?.trim() ?? '',
        enabled: existing.enabled !== false,
        updatedAt: refreshContentFromCast ? timestamp : existing.updatedAt,
      });
      continue;
    }

    if (!character.name.trim()) {
      continue;
    }

    next.push(dossierFromCast(character));
  }

  for (const dossier of dossiers) {
    if (used.has(dossier.id)) {
      continue;
    }

    if (dossier.castId && !cast.some((item) => item.id === dossier.castId)) {
      // Cast removed — drop the linked knowledge entry with it.
      continue;
    }

    if (!dossier.castId) {
      next.push(dossier);
    }
  }

  return next;
}

export function ensureNovelDossiers(novel: Pick<Novel, 'cast' | 'characterDossiers'>): NovelCharacterDossier[] {
  const cast = Array.isArray(novel.cast) ? novel.cast : [];
  const raw = Array.isArray(novel.characterDossiers)
    ? novel.characterDossiers.map((item, index) => normalizeCharacterDossier(item, index))
    : [];

  if (raw.length === 0 && cast.length > 0) {
    return cast.filter((item) => item.name.trim()).map((item) => dossierFromCast(item));
  }

  return syncDossiersWithCast(cast, raw);
}

/** Trigger keys for a knowledge entry: name + aliases. */
export function getDossierTriggerKeys(dossier: NovelCharacterDossier): string[] {
  const name = dossier.name.trim();
  return [name, ...normalizeAliases(dossier.aliases)].filter(Boolean);
}

const PRIVACY_LINE_RE =
  /^(性器官|生殖器|阴茎|阴蒂|胸部|敏感带|气味|性癖|XP|禁忌|雷点|私密常量)\s*[：:]/;

/** Drop privacy labeled lines when NSFW is off (still kept in stored dossier content). */
export function stripPrivacyFromDossierContent(content: string): string {
  return content
    .split('\n')
    .filter((line) => !PRIVACY_LINE_RE.test(line.trim()))
    .join('\n')
    .trim();
}

/** Inject 定稿经历 only — never include experienceDraft. Strip privacy when NSFW off. */
function formatDossierInjectContent(
  dossier: NovelCharacterDossier,
  nsfwEnabled: boolean,
): string {
  const name = dossier.name.trim();
  const rawContent = dossier.content.trim();
  const content = nsfwEnabled ? rawContent : stripPrivacyFromDossierContent(rawContent);
  const parts = [
    `【角色知识·${name}】`,
    content ? `设定：\n${content}` : '',
    dossier.experience.trim() ? `经历：\n${dossier.experience.trim()}` : '',
  ].filter(Boolean);

  return parts.join('\n');
}

/**
 * Convert novel character knowledge into worldbook entries
 * so they only inject when mentioned.
 */
export function dossiersToWorldbookEntries(
  dossiers: NovelCharacterDossier[],
  options?: {
    nsfwEnabled?: boolean;
    /** Skip protagonists — they are always-on in core memory. */
    protagonistCastIds?: Set<string>;
    protagonistNameKeys?: Set<string>;
    cast?: NovelCastCharacter[];
  },
): WorldbookEntry[] {
  const timestamp = new Date().toISOString();
  const nsfwEnabled = options?.nsfwEnabled === true;
  const protagonistCastIds = options?.protagonistCastIds;
  const protagonistNameKeys = options?.protagonistNameKeys;

  return dossiers
    .filter((item) => {
      if (item.enabled === false || item.stale === true || !item.name.trim()) {
        return false;
      }
      if (!(item.content.trim() || item.experience.trim())) {
        return false;
      }
      if (item.castId && protagonistCastIds?.has(item.castId)) {
        return false;
      }
      if (protagonistNameKeys?.has(item.name.trim().toLowerCase())) {
        return false;
      }
      return true;
    })
    .map((item) => {
      const keys = getDossierTriggerKeys(item);
      const character = options?.cast?.find((character) => character.id === item.castId || character.name.trim() === item.name.trim());
      const profession = character?.profession.trim() || parseLabeledField(item.content, '职业');
      if (profession) keys.push(profession);
      return {
        id: `novel-knowledge-${item.id}`,
        keys,
        content: formatDossierInjectContent(item, nsfwEnabled),
        enabled: true,
        ...(item.stale === true ? { stale: true } : {}),
        createdAt: item.updatedAt || timestamp,
        updatedAt: item.updatedAt || timestamp,
      };
    })
    .filter((item) => normalizeKeysNonEmpty(item.keys));
}

function normalizeKeysNonEmpty(keys: string | string[]) {
  const list = Array.isArray(keys) ? keys : keys.split(',');
  return list.some((key) => key.trim());
}

/** Keep identity visible even when the full supporting dossier is not retrieved. */
export function formatCastRosterForCore(novel: Pick<Novel, 'cast' | 'characterDossiers'>): string {
  const cast = novel.cast ?? [];
  const protagonistIds = new Set(
    cast.filter((item) => item.isProtagonist).map((item) => item.id),
  );
  const protagonistNames = new Set(
    cast
      .filter((item) => item.isProtagonist)
      .map((item) => item.name.trim().toLowerCase())
      .filter(Boolean),
  );

  const dossiers = ensureNovelDossiers(novel);
  const names = dossiers
    .filter((item) => {
      if (item.enabled === false || item.stale === true || !item.name.trim()) {
        return false;
      }
      if (item.castId && protagonistIds.has(item.castId)) {
        return false;
      }
      if (protagonistNames.has(item.name.trim().toLowerCase())) {
        return false;
      }
      return true;
    })
    .map((item) => {
      const character = cast.find((character) => character.id === item.castId || character.name.trim() === item.name.trim());
      const identity = [character?.profession || parseLabeledField(item.content, '职业'), character?.age || parseLabeledField(item.content, '年龄'), character?.affiliation || parseLabeledField(item.content, '阵营所属')].filter(Boolean).join('｜');
      return `${item.name.trim()}（${identity || '身份未填写'}）`;
    });

  if (names.length === 0) {
    const castNames = cast
      .filter((item) => !item.isProtagonist)
      .filter((item) => item.name.trim())
      .map((item) => `${item.name.trim()}（${[item.profession, item.age, item.affiliation].filter(Boolean).join('｜') || '身份未填写'}）`);
    if (castNames.length === 0) {
      return '';
    }
    return `【已建档配角索引·非出场名单】${castNames.join('、')}\n详细设定按本章场景及关联资料检索；名单不表示这些人物必须出场。`;
  }

  return `【已建档配角索引·非出场名单】${names.join('、')}\n详细设定按本章场景及关联资料检索；名单不表示这些人物必须出场。`;
}

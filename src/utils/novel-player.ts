import type { Novel, NovelCastCharacter, NovelCastCharacterPrivacy } from '@/types/tavern';
import {
  formatCharacterAiSummaryForPrompt,
  normalizeCharacterAiSummary,
} from '@/features/character-dossier-v2/ai-summary';
import { normalizeCharacterDossierV2 } from '@/features/character-dossier-v2/model';
import {
  ensureNovelDossiers,
  formatCastPrivacyLines,
  normalizeCastPrivacyFields,
} from '@/utils/novel-dossiers';
import { formatCastRelationsForInject } from '@/utils/novel-relations';
import { asString, generateId } from '@/utils/helpers';

/** Structured player-character fields (excluding name / motive / freeform persona). */
export type NovelPlayerProfileFields = {
  playerProfession: string;
  playerAge: string;
  playerGender: string;
  playerHeight: string;
  playerWeight: string;
  playerAppearance: string;
  playerPersonality: string;
  playerSpeechStyle: string;
  playerBackground: string;
  playerHabits: string;
  playerStrengths: string;
  playerWeaknesses: string;
  playerSecrets: string;
  playerPrivacy?: NovelCastCharacterPrivacy;
};

export const EMPTY_PLAYER_PROFILE_FIELDS: NovelPlayerProfileFields = {
  playerProfession: '',
  playerAge: '',
  playerGender: '',
  playerHeight: '',
  playerWeight: '',
  playerAppearance: '',
  playerPersonality: '',
  playerSpeechStyle: '',
  playerBackground: '',
  playerHabits: '',
  playerStrengths: '',
  playerWeaknesses: '',
  playerSecrets: '',
};
export function normalizePlayerProfileFields(
  novel: Partial<Novel> | null | undefined,
): NovelPlayerProfileFields {
  const privacy = normalizeCastPrivacyFields(novel?.playerPrivacy);
  return {
    playerProfession: asString(novel?.playerProfession),
    playerAge: asString(novel?.playerAge),
    playerGender: asString(novel?.playerGender),
    playerHeight: asString(novel?.playerHeight),
    playerWeight: asString(novel?.playerWeight),
    playerAppearance: asString(novel?.playerAppearance),
    playerPersonality: asString(novel?.playerPersonality),
    playerSpeechStyle: asString(novel?.playerSpeechStyle),
    playerBackground: asString(novel?.playerBackground),
    playerHabits: asString(novel?.playerHabits),
    playerStrengths: asString(novel?.playerStrengths),
    playerWeaknesses: asString(novel?.playerWeaknesses),
    playerSecrets: asString(novel?.playerSecrets),
    playerPrivacy: privacy,
  };
}

export function isProtagonistCast(character: NovelCastCharacter | null | undefined): boolean {
  return Boolean(character?.isProtagonist && character.name?.trim());
}

/** Named cast entries marked as protagonists (supports 男女双主角 etc.). */
export function getProtagonistCast(cast: NovelCastCharacter[] | null | undefined): NovelCastCharacter[] {
  return (cast ?? []).filter((item) => isProtagonistCast(item));
}

export function getProtagonistCastIds(cast: NovelCastCharacter[] | null | undefined): Set<string> {
  return new Set(getProtagonistCast(cast).map((item) => item.id).filter(Boolean));
}

export function getProtagonistNameKeys(cast: NovelCastCharacter[] | null | undefined): Set<string> {
  return new Set(
    getProtagonistCast(cast)
      .map((item) => item.name.trim().toLowerCase())
      .filter(Boolean),
  );
}

function createCastId() {
  return generateId('cast');
}

/** Build a protagonist cast card from legacy Novel.player* fields. */
export function playerFieldsToProtagonistCast(
  novel: Pick<
    Novel,
    | 'playerName'
    | 'playerPersona'
    | 'playerMotive'
    | 'playerProfession'
    | 'playerAge'
    | 'playerGender'
    | 'playerHeight'
    | 'playerWeight'
    | 'playerAppearance'
    | 'playerPersonality'
    | 'playerSpeechStyle'
    | 'playerBackground'
    | 'playerHabits'
    | 'playerStrengths'
    | 'playerWeaknesses'
    | 'playerSecrets'
    | 'playerPrivacy'
  >,
  options?: { stableId?: string },
): NovelCastCharacter {
  const profile = normalizePlayerProfileFields(novel);
  const privacy = normalizeCastPrivacyFields(novel.playerPrivacy ?? profile.playerPrivacy);
  const name = novel.playerName.trim();
  const stableFromName = name
    ? `cast-legacy-${name.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-')}`
    : createCastId();

  return {
    id: options?.stableId || stableFromName,
    name,
    profession: profile.playerProfession,
    age: profile.playerAge,
    gender: profile.playerGender,
    height: profile.playerHeight,
    weight: profile.playerWeight,
    appearance: profile.playerAppearance,
    personality: profile.playerPersonality,
    speechStyle: profile.playerSpeechStyle,
    background: profile.playerBackground,
    isProtagonist: true,
    motive: novel.playerMotive.trim(),
    strengths: profile.playerStrengths,
    weaknesses: profile.playerWeaknesses,
    habits: '',
    secrets: '',
    notes: '',
    ...(privacy ? { privacy } : {}),
  };
}

/** Mirror first protagonist into deprecated Novel.player* for persist / AI framework compat. */
type PlayerMirrorFields = Pick<
  Novel,
  | 'playerName'
  | 'playerPersona'
  | 'playerMotive'
  | 'playerProfession'
  | 'playerAge'
  | 'playerGender'
  | 'playerHeight'
  | 'playerWeight'
  | 'playerAppearance'
  | 'playerPersonality'
  | 'playerSpeechStyle'
  | 'playerBackground'
  | 'playerHabits'
  | 'playerStrengths'
  | 'playerWeaknesses'
  | 'playerSecrets'
  | 'playerPrivacy'
>;

export function mirrorProtagonistToPlayerFields(
  cast: NovelCastCharacter[],
  fallback?: PlayerMirrorFields,
): PlayerMirrorFields {
  const first = getProtagonistCast(cast)[0];
  if (!first) {
    return fallback ?? {
      playerName: '',
      playerPersona: '',
      playerMotive: '',
      ...EMPTY_PLAYER_PROFILE_FIELDS,
    };
  }

  const privacy = normalizeCastPrivacyFields(first.privacy);
  return {
    playerName: first.name.trim(),
    playerPersona: '',
    playerMotive: first.motive?.trim() ?? '',
    playerProfession: first.profession.trim(),
    playerAge: first.age.trim(),
    playerGender: first.gender.trim(),
    playerHeight: first.height.trim(),
    playerWeight: first.weight.trim(),
    playerAppearance: first.appearance.trim(),
    playerPersonality: first.personality.trim(),
    playerSpeechStyle: first.speechStyle.trim(),
    playerBackground: first.background.trim(),
    playerHabits: '',
    playerStrengths: first.strengths?.trim() ?? '',
    playerWeaknesses: first.weaknesses?.trim() ?? '',
    playerSecrets: '',
    ...(privacy ? { playerPrivacy: privacy } : { playerPrivacy: undefined }),
  };
}

/**
 * Ensure at least one protagonist cast exists when legacy playerName is set.
 * Enriches a same-name cast or prepends a new protagonist card.
 */
export function ensureProtagonistCastMigrated(
  cast: NovelCastCharacter[],
  novel: Pick<
    Novel,
    | 'playerName'
    | 'playerPersona'
    | 'playerMotive'
    | 'playerProfession'
    | 'playerAge'
    | 'playerGender'
    | 'playerHeight'
    | 'playerWeight'
    | 'playerAppearance'
    | 'playerPersonality'
    | 'playerSpeechStyle'
    | 'playerBackground'
    | 'playerHabits'
    | 'playerStrengths'
    | 'playerWeaknesses'
    | 'playerSecrets'
    | 'playerPrivacy'
  >,
): NovelCastCharacter[] {
  if (getProtagonistCast(cast).length > 0) {
    return cast;
  }

  const playerName = novel.playerName.trim();
  if (!playerName) {
    return cast;
  }

  const nameKey = playerName.toLowerCase();
  const matchIndex = cast.findIndex((item) => item.name.trim().toLowerCase() === nameKey);
  const fromPlayer = playerFieldsToProtagonistCast(novel);

  if (matchIndex >= 0) {
    const existing = cast[matchIndex];
    const merged: NovelCastCharacter = {
      ...existing,
      isProtagonist: true,
      motive: existing.motive?.trim() || fromPlayer.motive,
      strengths: existing.strengths?.trim() || fromPlayer.strengths,
      weaknesses: existing.weaknesses?.trim() || fromPlayer.weaknesses,
      habits: '',
      secrets: '',
      notes: '',
      profession: existing.profession.trim() || fromPlayer.profession,
      age: existing.age.trim() || fromPlayer.age,
      gender: existing.gender.trim() || fromPlayer.gender,
      height: existing.height.trim() || fromPlayer.height,
      weight: existing.weight.trim() || fromPlayer.weight,
      appearance: existing.appearance.trim() || fromPlayer.appearance,
      personality: existing.personality.trim() || fromPlayer.personality,
      speechStyle: existing.speechStyle.trim() || fromPlayer.speechStyle,
      background: existing.background.trim() || fromPlayer.background,
      privacy: existing.privacy ?? fromPlayer.privacy,
    };
    return cast.map((item, index) => (index === matchIndex ? merged : item));
  }

  return [fromPlayer, ...cast];
}

function formatOneProtagonistForCore(
  character: NovelCastCharacter,
  experience: string,
  options?: { nsfwEnabled?: boolean },
): string {
  const nsfwEnabled = options?.nsfwEnabled === true;
  if (character.aiSummary && character.dossierV2) {
    const dossier = normalizeCharacterDossierV2(character.dossierV2, character);
    const summary = normalizeCharacterAiSummary(character.aiSummary, character, dossier);
    return [
      `【主角·${character.name.trim()}】`,
      formatCharacterAiSummaryForPrompt(summary, { includePrivate: nsfwEnabled }),
      experience.trim() ? `定稿经历：${experience.trim()}` : '',
    ].filter(Boolean).join('\n');
  }
  const name = character.name.trim() || '玩家';
  const lines = [
    `【主角·${name}】`,
    character.profession.trim()
      ? `职业/身份：${character.profession.trim()}`
      : '',
    character.age.trim()
      ? `年龄：${character.age.trim()}`
      : '',
    character.gender.trim()
      ? `性别：${character.gender.trim()}`
      : '',
    character.height.trim()
      ? `身高：${character.height.trim()}`
      : '',
    character.weight.trim()
      ? `体重：${character.weight.trim()}`
      : '',
    character.birthplace?.trim()
      ? `出生地：${character.birthplace.trim()}`
      : '',
    character.affiliation?.trim()
      ? `阵营所属：${character.affiliation.trim()}`
      : '',
    character.appearance.trim()
      ? `外貌：${character.appearance.trim()}`
      : '',
    character.personality.trim()
      ? `性格：${character.personality.trim()}`
      : '',
    character.speechStyle.trim()
      ? `语气口吻：${character.speechStyle.trim()}`
      : '',
    character.background.trim()
      ? `出身过往：${character.background.trim()}`
      : '',
    character.strengths?.trim()
      ? `擅长优势：${character.strengths.trim()}`
      : '',
    character.weaknesses?.trim()
      ? `缺陷软肋：${character.weaknesses.trim()}`
      : '',
    character.motive?.trim()
      ? `核心动机：${character.motive.trim()}`
      : '',
    formatCastRelationsForInject(character.relations),
    experience.trim() ? `定稿经历：${experience.trim()}` : '',
    ...(nsfwEnabled ? formatCastPrivacyLines(character.privacy) : []),
  ].filter(Boolean);

  return lines.join('\n');
}

export function formatProtagonistAuthority(cast: NovelCastCharacter[]): string {
  const names = getProtagonistCast(cast).map((character) => character.name.trim());
  return names.length
    ? `【作者指定主角】${names.join('、')}\n主角身份以当前角色卡标记为准；创建蓝图、历史摘要和关系描述不能改变此指定。关系对象不因此成为主角。保持指定主角的故事主线，场景视角切换不等于更换主角。`
    : '';
}

function formatLegacyPlayerProfileForCore(
  novel: Pick<
    Novel,
    | 'playerName'
    | 'playerPersona'
    | 'playerMotive'
    | 'playerProfession'
    | 'playerAge'
    | 'playerGender'
    | 'playerHeight'
    | 'playerWeight'
    | 'playerAppearance'
    | 'playerPersonality'
    | 'playerSpeechStyle'
    | 'playerBackground'
    | 'playerHabits'
    | 'playerStrengths'
    | 'playerWeaknesses'
    | 'playerSecrets'
    | 'playerPrivacy'
  >,
  options?: { nsfwEnabled?: boolean },
): string {
  const nsfwEnabled = options?.nsfwEnabled === true;
  const name = novel.playerName.trim() || '玩家';
  const profile = normalizePlayerProfileFields(novel);
  const lines = [
    `【主角·${name}】`,
    profile.playerProfession ? `职业/身份：${profile.playerProfession}` : '',
    profile.playerAge ? `年龄：${profile.playerAge}` : '',
    profile.playerGender ? `性别：${profile.playerGender}` : '',
    profile.playerHeight ? `身高：${profile.playerHeight}` : '',
    profile.playerWeight ? `体重：${profile.playerWeight}` : '',
    profile.playerAppearance ? `外貌：${profile.playerAppearance}` : '',
    profile.playerPersonality ? `性格：${profile.playerPersonality}` : '',
    profile.playerSpeechStyle ? `语气口吻：${profile.playerSpeechStyle}` : '',
    profile.playerBackground ? `出身过往：${profile.playerBackground}` : '',
    profile.playerStrengths ? `擅长优势：${profile.playerStrengths}` : '',
    profile.playerWeaknesses ? `缺陷软肋：${profile.playerWeaknesses}` : '',
    novel.playerMotive.trim() ? `核心动机：${novel.playerMotive.trim()}` : '',
    ...(nsfwEnabled ? formatCastPrivacyLines(profile.playerPrivacy) : []),
  ].filter(Boolean);

  return lines.join('\n');
}

/**
 * Always-on protagonist block(s) for novel core memory.
 * Prefers cast cards with isProtagonist (supports multiple); falls back to legacy player*.
 */
export function formatPlayerProfileForCore(
  novel: Pick<
    Novel,
    | 'cast'
    | 'characterDossiers'
    | 'playerName'
    | 'playerPersona'
    | 'playerMotive'
    | 'playerProfession'
    | 'playerAge'
    | 'playerGender'
    | 'playerHeight'
    | 'playerWeight'
    | 'playerAppearance'
    | 'playerPersonality'
    | 'playerSpeechStyle'
    | 'playerBackground'
    | 'playerHabits'
    | 'playerStrengths'
    | 'playerWeaknesses'
    | 'playerSecrets'
    | 'playerPrivacy'
  >,
  options?: { nsfwEnabled?: boolean },
): string {
  const protagonists = getProtagonistCast(novel.cast);
  if (protagonists.length === 0) {
    return formatLegacyPlayerProfileForCore(novel, options);
  }

  const dossiers = ensureNovelDossiers(novel);
  const byCastId = new Map(
    dossiers.filter((item) => item.castId).map((item) => [item.castId!, item]),
  );
  const byName = new Map(
    dossiers
      .filter((item) => item.name.trim())
      .map((item) => [item.name.trim().toLowerCase(), item]),
  );

  return protagonists
    .map((character) => {
      const dossier =
        (character.id ? byCastId.get(character.id) : undefined) ??
        byName.get(character.name.trim().toLowerCase());
      return formatOneProtagonistForCore(character, dossier?.experience ?? '', {
        ...options,
        nsfwEnabled: options?.nsfwEnabled === true,
      });
    })
    .join('\n\n');
}

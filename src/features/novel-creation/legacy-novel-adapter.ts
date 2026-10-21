import { DEFAULT_CHARACTER_CARD_APPEARANCE_ID } from '@/constants/character-card-appearances';
import type { NovelPromptDefaults } from '@/store/tavern-store';
import type { CreateNovelInput, NovelCreationBlueprint, NovelProjectBrief } from '@/types/tavern';
import { EMPTY_PLAYER_PROFILE_FIELDS } from '@/utils/novel-player';

import { compileStoryFoundation } from './blueprint-compiler';
import type { StoryBlueprint } from './domain';

export function buildLegacyNovelInput({
  blueprint,
  promptDefaults,
}: {
  blueprint: StoryBlueprint;
  promptDefaults: NovelPromptDefaults;
}): CreateNovelInput {
  const foundationPrompt = compileStoryFoundation(blueprint);
  const constraints = blueprint.constraints.map((item) => item.trim()).filter(Boolean).join('\n');
  const creationBlueprint: NovelCreationBlueprint = {
    profile: { structure: 'single_world', entry: 'none', focus: 'mixed', knownPlot: false },
    storyCore: {
      title: blueprint.title.trim(),
      brief: blueprint.premise.trim(),
      premise: blueprint.premise.trim(),
      theme: blueprint.tone.trim(),
      ending: blueprint.direction.trim(),
      plannedChapters: 20,
      firstChapterGoal: blueprint.opening.trim(),
      worldName: '',
      worldEra: blueprint.setting.trim(),
      gameRules: constraints,
    },
    protagonistCore: {
      identity: blueprint.protagonist.identity.trim(),
      goal: blueprint.protagonist.desire.trim(),
    },
    foundationPrompt,
  };
  const projectBrief: NovelProjectBrief = {
    premise: blueprint.premise.trim(),
    theme: blueprint.tone.trim(),
    protagonistArc: '',
    ending: blueprint.direction.trim(),
    plannedChapters: 20,
    firstChapterGoal: blueprint.opening.trim(),
    storyKind: 'serialized',
  };

  return {
    name: blueprint.title.trim(),
    shortIntro: blueprint.premise.trim().slice(0, 120),
    detailedIntro: blueprint.premise.trim(),
    systemPrompt: promptDefaults.systemPrompt,
    writingStyle: '',
    shortTermMemoryPrompt: promptDefaults.shortTermMemoryPrompt,
    midTermMemoryPrompt: promptDefaults.midTermMemoryPrompt,
    longTermMemoryPrompt: promptDefaults.longTermMemoryPrompt,
    playerName: '',
    playerPersona: blueprint.protagonist.identity.trim(),
    playerMotive: blueprint.protagonist.desire.trim(),
    ...EMPTY_PLAYER_PROFILE_FIELDS,
    worldName: '',
    worldEra: blueprint.setting.trim(),
    worldConflict: '',
    worldTone: '',
    mainPlot: '',
    initialStoryState: '',
    gameRules: constraints,
    autoSuggestRoutes: false,
    relationGraphEnabled: false,
    characterCardAppearanceId: DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
    cast: [],
    characterDossiers: [],
    loreEntries: [],
    relationGraphs: [],
    openingMessage: '',
    defaultModelId: '',
    defaultProviderId: undefined,
    chatBackgroundOpacity: 0.35,
    foundationPrompt,
    creationBlueprint,
    projectBrief,
    creationMode: 'interactive',
    agentMode: 'narrator',
    agentReviewMode: 'fast',
    isDraft: false,
    createStep: 3,
    isContinuationProject: false,
  };
}

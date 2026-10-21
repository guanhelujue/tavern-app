import type { NovelInjectionToggles } from '@/types/tavern';

export type { NovelInjectionToggles };

export const DEFAULT_NOVEL_INJECTION_TOGGLES: NovelInjectionToggles = {
  systemPrompt: true,
  writingStyle: false,
  gameRules: true,
  characterCards: true,
  worldCards: true,
};

export const NOVEL_INJECTION_TOGGLE_OPTIONS: {
  key: keyof NovelInjectionToggles;
  label: string;
  description: string;
}[] = [
  {
    key: 'systemPrompt',
    label: '系统提示词',
    description: '快穿章节使用专用叙事规则；关闭后只保留最简正文与章节边界。',
  },
  {
    key: 'gameRules',
    label: '游玩规则',
    description: '快穿模式控制系统硬规则、本世界规则与当前任务；普通小说控制游玩规则。',
  },
  {
    key: 'characterCards',
    label: '角色卡',
    description: '快穿模式控制当前身份、主角卡、本章相关角色摘要与命中的角色档案。',
  },
  {
    key: 'worldCards',
    label: '世界设定与世界书',
    description: '快穿模式控制当前小世界、相关原定剧情、偏差与世界书；当前章节大纲不受影响。',
  },
];

export function normalizeNovelInjectionToggles(
  value?: Partial<NovelInjectionToggles> | null,
): NovelInjectionToggles {
  return {
    systemPrompt: value?.systemPrompt !== false,
    // Writing-style injection retired; keep field for persisted session compat.
    writingStyle: false,
    gameRules: value?.gameRules !== false,
    characterCards: value?.characterCards !== false,
    worldCards: value?.worldCards !== false,
  };
}

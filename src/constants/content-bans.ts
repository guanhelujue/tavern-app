export type ContentBanKey = 'gore' | 'ntr' | 'noncon';

export type ContentBanFlags = Record<ContentBanKey, boolean>;

export const CONTENT_BAN_OPTIONS: {
  key: ContentBanKey;
  label: string;
  description: string;
  promptLine: string;
}[] = [
  {
    key: 'gore',
    label: '禁血腥肢解',
    description: '避免详细血腥、肢解与虐杀描写',
    promptLine: '禁止详细血腥、肢解、开膛与虐杀特写；冲突可用抽象结果交代。',
  },
  {
    key: 'ntr',
    label: '禁 NTR',
    description: '避免绿帽 / 出轨伤害向情节',
    promptLine: '禁止 NTR、绿帽、出轨羞辱等以伴侣出轨为核心的伤害向情节。',
  },
  {
    key: 'noncon',
    label: '禁强迫',
    description: '避免非自愿性行为描写',
    promptLine: '禁止非自愿、强迫或迷奸类性行为描写；亲密互动须建立在双方自愿上。',
  },
];

export const DEFAULT_CONTENT_BAN_FLAGS: ContentBanFlags = {
  gore: false,
  ntr: false,
  noncon: false,
};

export function normalizeContentBanFlags(
  value?: Partial<ContentBanFlags> | null,
): ContentBanFlags {
  return {
    gore: Boolean(value?.gore),
    ntr: Boolean(value?.ntr),
    noncon: Boolean(value?.noncon),
  };
}


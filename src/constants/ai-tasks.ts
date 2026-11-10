import type { AiTaskId } from '@/types/tavern';

export type AiTaskMeta = { label: string; purpose: 'chat' | 'utility' };

export const AI_TASKS: Record<AiTaskId, AiTaskMeta> = {
  writing: { label: '正文写作', purpose: 'chat' },
  inspiration: { label: '灵感', purpose: 'utility' },
  creation: { label: '作品创建', purpose: 'utility' },
  character: { label: '人物', purpose: 'utility' },
  outline: { label: '大纲与规划', purpose: 'utility' },
  world: { label: '世界观', purpose: 'utility' },
  review: { label: '审校', purpose: 'utility' },
  analysis: { label: '分析', purpose: 'utility' },
  memory: { label: '记忆', purpose: 'utility' },
  style: { label: '文风', purpose: 'utility' },
  prompt: { label: '提示词', purpose: 'utility' },
  comic: { label: '漫画', purpose: 'utility' },
  chat: { label: '对话', purpose: 'chat' },
};

export const AI_TASK_IDS = Object.keys(AI_TASKS) as AiTaskId[];

import type { ImageSource } from 'expo-image';

/** 厂商品牌 Logo（SVG 图标，来自 G:\novel\public\logos）。 */
export const PROVIDER_LOGO_SOURCES: Record<string, ImageSource> = {
  deepseek: require('../../assets/logos/deepseek.svg'),
  mimo: require('../../assets/logos/mimo.svg'),
  gemini: require('../../assets/logos/google.svg'),
  openai: require('../../assets/logos/openai.svg'),
  anthropic: require('../../assets/logos/anthropic.svg'),
  qwen: require('../../assets/logos/qwen.svg'),
  minimax: require('../../assets/logos/minimax.svg'),
  glm: require('../../assets/logos/glm.svg'),
  kimi: require('../../assets/logos/kimi.svg'),
  xai: require('../../assets/logos/xai.svg'),
  openrouter: require('../../assets/logos/openrouter.svg'),
  groq: require('../../assets/logos/groq.svg'),
  'custom-openai-compatible': require('../../assets/logos/custom.svg'),
};

export function providerLogoSource(providerId: string): ImageSource | undefined {
  return PROVIDER_LOGO_SOURCES[providerId];
}

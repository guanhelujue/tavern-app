/** Keep the API identifier intact in storage; use a readable name in controls. */
export function modelDisplayName(modelId: string): string {
  const name = modelId.split('/').at(-1) ?? modelId;
  if (/^gpt[- ]/i.test(name)) return name.replace(/^gpt[- ]/i, 'GPT-');
  return name.replace(/[-_]/g, ' ').replace(/\b(deepseek|openai|claude|gemini|qwen|kimi|grok|mimo|minimax)\b/gi, (brand) => ({
    deepseek: 'DeepSeek', openai: 'OpenAI', claude: 'Claude', gemini: 'Gemini',
    qwen: 'Qwen', kimi: 'Kimi', grok: 'Grok', mimo: 'MiMo', minimax: 'MiniMax',
  })[brand.toLowerCase()] ?? brand).replace(/\b(chat|reasoner|flash|pro|sonnet|opus|haiku)\b/gi, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

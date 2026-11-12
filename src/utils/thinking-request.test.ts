import { describe, expect, it } from 'vitest';

import { buildThinkingBody } from './thinking-request';

describe('thinking parameters for proxy models', () => {
  it('recognizes a DeepSeek model behind a custom connection', () => {
    expect(buildThinkingBody('proxy-1', 'deepseek-flash', false, true))
      .toEqual({ thinking: { type: 'enabled' } });
    expect(buildThinkingBody('proxy-1', 'deepseek-flash', true, true))
      .toEqual({ thinking: { type: 'disabled' } });
  });

  it('lets an unknown model use the parameter chosen by the user', () => {
    expect(buildThinkingBody('proxy-1', 'novel-reasoner', false, true, 'enable_thinking'))
      .toEqual({ enable_thinking: true });
    expect(buildThinkingBody('proxy-1', 'novel-reasoner', false, true, 'none'))
      .toEqual({});
  });

  it('does not send an unsupported off value to Gemini 3 proxy models', () => {
    expect(buildThinkingBody('proxy-1', 'gemini-3.7-flash-high', true, true)).toEqual({});
    expect(buildThinkingBody('proxy-1', 'gemini-3.7-flash-high', false, true))
      .toEqual({ reasoning_effort: 'high' });
  });
});

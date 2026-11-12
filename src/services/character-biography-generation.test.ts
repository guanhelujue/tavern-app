import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestCompletionWithUsage } from './llm';
import {
  CHARACTER_BIOGRAPHY_SYSTEM_PROMPT,
  generateCharacterBiography,
} from './character-biography-generation';

vi.mock('./llm', async (importOriginal) => ({
  ...await importOriginal<typeof import('./llm')>(),
  requestCompletionWithUsage: vi.fn(),
}));

const mockedCompletion = vi.mocked(requestCompletionWithUsage);

const apiSettings = {
  baseUrl: 'https://example.invalid/v1',
  apiKey: '<REDACTED>',
  model: 'test-model',
  temperature: 0.8,
  maxTokens: 8000,
  contextWindowMessages: 20,
  streamingEnabled: false,
  requestTimeoutMs: 30_000,
  requestRetryCount: 0,
  debugPromptInspectorEnabled: false,
  replyLengthPreset: 'normal' as const,
  continuationOnTruncation: false,
};

const dossier = {
  version: 2 as const,
  public: {
    birthDate: '', residence: '', bodyFat: '', measurements: '', shoeSize: '',
    bodyStats: '', clothingStyle: '', personalityAndLife: '',
  },
  private: {
    variant: 'male' as const,
    penis: '', testiclesAndPubicHair: '', anus: '', intimateBody: '',
    sexualResponse: '', intimacyProfile: '',
  },
};

const character = {
  id: 'cast-1', name: '沈砚舟', profession: '运动员', age: '22', gender: '男',
  height: '184cm', weight: '78kg', appearance: '左眉有浅疤', personality: '寡言',
  speechStyle: '短句', background: '体育特招生', biographies: [{
    id: 'hidden-biography', title: '不应被读取', request: '秘密要求',
    content: 'OLD_BIOGRAPHY_MUST_NOT_ENTER_PROMPT', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  }],
};

const input = { apiSettings, character, dossier, request: '写一个雨夜。', nsfwEnabled: false };

describe('character biography generation', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    mockedCompletion.mockReset();
    mockedCompletion.mockResolvedValue({
      content: '{"title":"更衣室熄灯以后","content":"他最后一个离开更衣室。"}',
      promptTokens: 120,
      completionTokens: 80,
      model: 'test-model',
      finishReason: 'stop',
    });
  });

  it('keeps the prompt generic and returns one requested piece', async () => {
    const result = await generateCharacterBiography({
      apiSettings,
      character,
      dossier,
      request: '写他输掉比赛后独自留下的一晚。',
      nsfwEnabled: false,
    });

    expect(result.title).toBe('更衣室熄灯以后');
    expect(result.content).toBe('他最后一个离开更衣室。');
    expect(result.usedRawResponse).toBe(false);
    expect(result.truncated).toBe(false);
    expect(CHARACTER_BIOGRAPHY_SYSTEM_PROMPT).toContain('不预设小传类型');
    expect(CHARACTER_BIOGRAPHY_SYSTEM_PROMPT).not.toContain('四则');
  });

  it.each([
    ['literal newlines', '{"title":"雨夜","content":"他站在屋檐下。\n雨落了一整夜。"}'],
    ['unescaped quotes', '{"title":"雨夜","content":"他说"回去吧"。"}'],
    ['plain text', '雨夜\n\n他站在屋檐下。'],
    ['invalid fenced JSON', '```json\n{"title":"雨夜","content":"第一段\n第二段"}\n```'],
    ['two pieces', '{"title":"一","content":"第一篇"}\n{"title":"二","content":"第二篇"}'],
    ['an array of pieces', '[{"title":"一","content":"第一篇"},{"title":"二","content":"第二篇"}]'],
    ['different field names', '{"标题":"雨夜","正文":"他站在屋檐下。"}'],
    ['empty content field', '{"title":"雨夜","content":""}'],
  ])('keeps the entire response for manual editing: %s', async (_label, content) => {
    mockedCompletion.mockResolvedValue({ content, promptTokens: 120, completionTokens: 80 });

    const result = await generateCharacterBiography(input);

    expect(result).toMatchObject({
      title: '未命名小传', content, usedRawResponse: true, truncated: false,
      promptTokens: 120, completionTokens: 80,
    });
    expect(mockedCompletion).toHaveBeenCalledTimes(1);
  });

  it('still extracts a valid fenced JSON response', async () => {
    mockedCompletion.mockResolvedValue({ content: '```json\n{"title":"雨夜","content":"第一段\\n第二段"}\n```' });
    expect(await generateCharacterBiography(input)).toMatchObject({
      title: '雨夜', content: '第一段\n第二段', usedRawResponse: false,
    });
  });

  it.each(['length', 'max_tokens', 'MAX_TOKENS', 'max_output_tokens', 'max_completion_tokens', 'token_limit', 'incomplete_max_output_tokens'])(
    'preserves all received text and reports truncation for %s', async (finishReason) => {
      const content = '{"title":"雨夜","content":"' + '雨落了一整夜。'.repeat(2000);
      mockedCompletion.mockResolvedValue({ content, finishReason });

      expect(await generateCharacterBiography(input)).toMatchObject({
        content, usedRawResponse: true, truncated: true,
      });
    },
  );

  it('reports truncation even when the returned JSON parses', async () => {
    mockedCompletion.mockResolvedValue({ content: '{"title":"雨夜","content":"第一段。"}', finishReason: 'length' });
    expect(await generateCharacterBiography(input)).toMatchObject({
      content: '第一段。', usedRawResponse: false, truncated: true,
    });
  });

  it.each(['', ' \n\t '])('rejects an empty response instead of creating a blank biography', async (content) => {
    mockedCompletion.mockResolvedValue({ content, reasoningContent: '内部推理，不是正文' });
    await expect(generateCharacterBiography(input)).rejects.toThrow('模型没有返回小传正文');
  });

  it.each([16000, 32000])('honors a configured %i token budget above the old cap', async (maxTokens) => {
    await generateCharacterBiography({ ...input, maxTokens });
    expect(mockedCompletion.mock.calls[0]?.[0].maxTokens).toBe(maxTokens);
  });

  it.each([undefined, NaN, Infinity, -1, 0])('uses the default budget for invalid or missing input %s', async (maxTokens) => {
    await generateCharacterBiography({ ...input, maxTokens });
    expect(mockedCompletion.mock.calls[0]?.[0].maxTokens).toBe(8000);
  });

  it.each(['stop', 'length'])('retains text through the real HTTP response handler with finish reason %s', async (finishReason) => {
    const content = '{"title":"雨夜","content":"第一段\n第二段';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }],
      usage: { prompt_tokens: 120, completion_tokens: 80 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const actual = await vi.importActual<typeof import('./llm')>('./llm');
    mockedCompletion.mockImplementationOnce(actual.requestCompletionWithUsage);

    const result = await generateCharacterBiography({ ...input, maxTokens: 32000 });

    expect(result).toMatchObject({
      content, usedRawResponse: true, truncated: finishReason === 'length',
      promptTokens: 120, completionTokens: 80,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ max_tokens: 32000, stream: false });
  });

  it.each([
    {
      label: 'Responses refusal',
      protocol: 'openai-responses',
      payload: { status: 'completed', output: [{ type: 'message', content: [
        { type: 'refusal', refusal: '第一段说明。' }, { type: 'refusal', refusal: '第二段说明。' },
      ] }] },
      expected: '模型拒绝了这次请求。\n第一段说明。\n第二段说明。',
    },
    {
      label: 'Chat Completions refusal',
      protocol: 'openai-compatible',
      payload: { choices: [{ finish_reason: 'stop', message: { content: null, refusal: '无法协助此 network 请求。' } }] },
      expected: '模型拒绝了这次请求。\n无法协助此 network 请求。',
    },
    {
      label: 'Chat Completions refusal part',
      protocol: 'openai-compatible',
      payload: { choices: [{ finish_reason: 'stop', message: { content: [{ type: 'refusal', refusal: '服务说明。' }] } }] },
      expected: '模型拒绝了这次请求。\n服务说明。',
    },
    {
      label: 'empty response',
      protocol: 'openai-responses',
      payload: { status: 'completed', output: [] },
      expected: '服务未返回正文。',
    },
  ] as const)('reports $label through the biography error and debug history', async ({ protocol, payload, expected }) => {
    const actual = await vi.importActual<typeof import('./llm')>('./llm');
    mockedCompletion.mockImplementationOnce(actual.requestCompletionWithUsage);
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(payload)));
    vi.stubGlobal('fetch', fetchMock);
    const settings = { ...apiSettings, protocol, debugPromptInspectorEnabled: true, requestRetryCount: 1 };
    try {
      await expect(generateCharacterBiography({ ...input, apiSettings: settings })).rejects.toThrow(new Error(expected));
      expect(actual.getDebugRequestHistory().at(-1)).toMatchObject({ finishReason: 'stop', error: expected });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      actual.clearDebugRequestHistory();
    }
  });

  it('keeps actual Responses prose editable when the response also includes a refusal part', async () => {
    const actual = await vi.importActual<typeof import('./llm')>('./llm');
    mockedCompletion.mockImplementationOnce(actual.requestCompletionWithUsage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      status: 'completed', output: [{ type: 'message', content: [
        { type: 'output_text', text: '雨停了。\n他推开了窗。' }, { type: 'refusal', refusal: '单独的说明。' },
      ] }],
    })));
    expect(await generateCharacterBiography({ ...input, apiSettings: { ...apiSettings, protocol: 'openai-responses' } }))
      .toMatchObject({ content: '雨停了。\n他推开了窗。', usedRawResponse: true });
  });

  it('never feeds previously stored biographies back into the model', async () => {
    await generateCharacterBiography({
      apiSettings,
      character,
      dossier,
      request: '写一个全新的片段。',
      nsfwEnabled: false,
    });

    const call = mockedCompletion.mock.calls[0]?.[0];
    const prompt = call?.messages.map((message) => message.content).join('\n') ?? '';
    expect(prompt).not.toContain('OLD_BIOGRAPHY_MUST_NOT_ENTER_PROMPT');
    expect(prompt).not.toContain('hidden-biography');
  });

  it('injects only enabled writing extensions independently of dossier data', async () => {
    await generateCharacterBiography({
      apiSettings, character, dossier, request: '写一个日常片段。', nsfwEnabled: true,
      writingExtensions: {
        jailbreakEnabled: false, jailbreakPrompt: 'DISABLED_EXTENSION_MARKER',
        modEnabled: true, modPrompt: 'ACTIVE_MOD_MARKER',
      },
    });
    const prompt = mockedCompletion.mock.calls[0]?.[0].messages.map((message) => message.content).join('\n') ?? '';
    expect(prompt).not.toContain('DISABLED_EXTENSION_MARKER');
    expect(prompt).toContain('ACTIVE_MOD_MARKER');
    expect(prompt).toContain('privateDossier');
  });
});

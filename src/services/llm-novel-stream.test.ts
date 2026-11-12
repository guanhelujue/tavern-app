import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiSettings, Novel } from '../types/tavern';
import { requestChatCompletion, requestCompletionWithUsage } from './llm';
import type { NovelContextPack } from './novel-context-pack';
import { deriveNovelRequestFailure, formatNovelRequestFailureContent } from './novel-request-lifecycle';

const settings: ApiSettings = {
  baseUrl: 'https://example.invalid/v1',
  apiKey: '',
  model: 'test-model',
  temperature: 0.5,
  maxTokens: 100,
  contextWindowMessages: 10,
  streamingEnabled: true,
  requestTimeoutMs: 15_000,
  requestRetryCount: 1,
  debugPromptInspectorEnabled: false,
  replyLengthPreset: 'normal',
  continuationOnTruncation: false,
};

const messages = [{ role: 'user' as const, content: 'test' }];
const encoder = new TextEncoder();
const chapterNovel = {
  id: 'test-novel',
  name: '测试小说',
  systemPrompt: '请写小说正文。',
  cast: [],
  worldName: '',
  worldEra: '',
  gameRules: '',
  autoSuggestRoutes: false,
  continuationSettings: { targetWords: 2000 },
  outline: {
    summary: '',
    volumes: [{ id: 'volume', title: '第一卷', summary: '', chapters: [
      { index: 2, title: '出发', goal: '主角离开家' },
    ] }],
    updatedAt: '2026-09-25T00:00:00.000Z',
  },
} as unknown as Novel;
const emptyContextPack = {
  currentChapterGoal: [], currentScene: [], recentMessages: [], recentChapterSummaries: [],
  activeCharacters: [], lockedWorldFacts: [], relevantRelations: [], unresolvedHooks: [],
  styleConstraints: [], worldbookEntries: [], stateVersion: 0,
  contextManifest: {
    budgetTokens: 10000, estimatedTokens: 0, estimation: 'chars-div-2', selected: [],
    clipped: [], staleExcluded: [], sourceVersions: {}, selectionReasons: {},
  },
} as NovelContextPack;

function writeChapterResponse() {
  return requestChatCompletion({
    apiSettings: settings,
    novel: chapterNovel,
    history: [{ role: 'user', content: '开始第二章' }],
    sessionConfig: { injectionToggles: { characterCards: false, worldCards: false } },
    contextPack: emptyContextPack,
  });
}

function successfulResponse(content: string, finishReason = 'stop') {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] })}\n\n`));
      controller.close();
    },
  }), { status: 200 });
}

function interruptedResponse(content: string) {
  let reads = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      reads += 1;
      if (reads === 1) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
      } else {
        controller.error(new Error('network interrupted'));
      }
    },
  }), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('novel-chat streaming lifecycle', () => {
  it('does not arm the client request timeout for novel-chat', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulResponse('done')));

    const result = await requestCompletionWithUsage({ apiSettings: settings, messages, purpose: 'novel-chat' });

    expect(result.content).toBe('done');
    expect(timer).not.toHaveBeenCalledWith(expect.any(Function), 15_000);
  });

  it('keeps the configured timeout for utility requests', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulResponse('done')));

    await requestCompletionWithUsage({ apiSettings: settings, messages, purpose: 'utility-memory' });

    expect(timer).toHaveBeenCalledWith(expect.any(Function), 15_000);
  });

  it('does not retry after visible text and retains that text on failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(interruptedResponse('draft'))
      .mockResolvedValueOnce(successfulResponse('refusal'));
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = [];

    let failure: unknown;
    try {
      await requestCompletionWithUsage({
        apiSettings: settings,
        messages,
        purpose: 'novel-chat',
        onDelta: (delta) => deltas.push(delta),
      });
    } catch (error) {
      failure = error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(['draft']);
    expect(formatNovelRequestFailureContent('正在生成回复...', deriveNovelRequestFailure(failure)))
      .toContain('draft');
  });

  it('preserves visible text when the user stops generation', async () => {
    const external = new AbortController();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"draft"}}]}\n\n'));
          init.signal?.addEventListener('abort', () =>
            controller.error(new DOMException('Aborted', 'AbortError')));
        },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    let failure: unknown;
    try {
      await requestCompletionWithUsage({
        apiSettings: settings,
        messages,
        purpose: 'novel-chat',
        signal: external.signal,
        onDelta: () => external.abort(),
      });
    } catch (error) {
      failure = error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestFailure = deriveNovelRequestFailure(failure);
    expect(requestFailure.aborted).toBe(true);
    expect(formatNovelRequestFailureContent('正在生成回复...', requestFailure)).toContain('draft');
  });

  it('can still retry when the first request fails before any text arrives', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network interrupted'))
      .mockResolvedValueOnce(successfulResponse('done'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestCompletionWithUsage({ apiSettings: settings, messages, purpose: 'novel-chat' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('done');
  });
});

describe('novel chapter response errors', () => {
  it('reports a short response that stops in the middle of a sentence', async () => {
    const draft = `第2章 出发\n\n${'主角沿路向前。'.repeat(80)}他决定先`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulResponse(draft)));

    const error = await writeChapterResponse().then(() => null, (failure: unknown) => failure);
    expect(error).toMatchObject({
      code: 'novel_incomplete_chapter',
      partialContent: draft,
    });
    const visibleFailure = formatNovelRequestFailureContent(
      '正在生成回复...',
      deriveNovelRequestFailure(error),
    );
    expect(visibleFailure).toContain('末句未写完');
    expect(visibleFailure).toContain('目标约 2000 字');
    expect(visibleFailure).toContain('他决定先');
  });

  it('distinguishes an underlength but complete-looking chapter', async () => {
    const draft = `第2章 出发\n\n${'主角沿路向前。'.repeat(80)}`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulResponse(draft)));

    await expect(writeChapterResponse()).rejects.toMatchObject({
      code: 'novel_short_chapter',
      partialContent: draft,
    });
  });

  it('identifies a model refusal instead of treating it as a chapter', async () => {
    const refusal = '我无法满足您的这一请求。';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulResponse(refusal)));

    await expect(writeChapterResponse()).rejects.toMatchObject({
      code: 'novel_model_refusal',
      partialContent: refusal,
    });
  });

  it('reports an upstream content-filter finish reason separately', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulResponse('已生成的片段', 'content_filter')));

    await expect(writeChapterResponse()).rejects.toMatchObject({
      code: 'novel_provider_block',
      partialContent: '已生成的片段',
    });
  });

  it('reports a length limit after the one automatic continuation is still cut short', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(successfulResponse('第一段。', 'length'))
      .mockResolvedValueOnce(successfulResponse('第二段。', 'length'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(writeChapterResponse()).rejects.toMatchObject({
      code: 'novel_length_limit',
      partialContent: '第一段。\n第二段。',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts a chapter that reaches its target', async () => {
    const draft = `第2章 出发\n\n${'主角沿路向前。'.repeat(280)}`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulResponse(draft)));

    await expect(writeChapterResponse()).resolves.toMatchObject({ content: draft });
  });

  it('does not impose chapter word counts on ordinary novel chat', async () => {
    const draft = '主角点了点头。';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulResponse(draft)));

    await expect(requestChatCompletion({
      apiSettings: settings,
      novel: { ...chapterNovel, outline: undefined },
      history: [{ role: 'user', content: '说一句话' }],
      sessionConfig: { injectionToggles: { characterCards: false, worldCards: false } },
      contextPack: emptyContextPack,
    })).resolves.toMatchObject({ content: draft });
  });
});

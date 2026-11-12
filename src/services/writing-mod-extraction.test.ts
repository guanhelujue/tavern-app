import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MOD_EXTRACTION_PROMPT } from '../constants/writing-mod';
import type { ApiSettings } from '../types/tavern';
import { prepareWritingModSamples } from '../utils/writing-mods';
import { requestPlainCompletion } from './llm';
import { extractWritingMod, parseExtractedWritingMod } from './writing-mod-extraction';

vi.mock('./llm', () => ({ requestPlainCompletion: vi.fn() }));
const completion = vi.mocked(requestPlainCompletion);
const apiSettings: ApiSettings = {
  baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'test', temperature: 0.8,
  maxTokens: 8000, contextWindowMessages: 20, streamingEnabled: false,
  requestTimeoutMs: 30000, requestRetryCount: 0, debugPromptInspectorEnabled: false,
  replyLengthPreset: 'normal', continuationOnTruncation: false,
};

describe('writing MOD extraction', () => {
  beforeEach(() => { completion.mockReset(); });

  it('blocks already-corrupted imported or pasted text before any API request', async () => {
    await expect(extractWritingMod({ apiSettings, sampleText: '正文����', extractionPrompt: '' })).rejects.toThrow(/乱码|损坏/);
    expect(completion).not.toHaveBeenCalled();
  });

  it('uses the dedicated instructions and utility request, returning an editable draft', async () => {
    completion.mockResolvedValue('```json\n{"name":" 克制叙事 ","content":"规则一\\n规则二"}\n```');
    const signal = new AbortController().signal;
    const result = await extractWritingMod({ apiSettings, sampleText: '文章样本', extractionPrompt: 'CUSTOM_RULES', signal });
    expect(result).toEqual({ name: '克制叙事', content: '规则一\n规则二' });
    const call = completion.mock.calls[0][0];
    expect(call.messages[0].content).toContain('CUSTOM_RULES');
    expect(call.messages[1].content).toContain('文章样本');
    expect(call.messages[1].content).not.toContain('给出可核对的来源位置');
    expect(call.purpose).toBe('utility-mod-extract');
    expect(call.signal).toBe(signal);
  });

  it('falls back to default instructions when customization is blank', async () => {
    completion.mockResolvedValue('{"name":"A","content":"B"}');
    await extractWritingMod({ apiSettings, sampleText: '文章', extractionPrompt: ' ' });
    expect(completion.mock.calls[0][0].messages[0].content).toContain(DEFAULT_MOD_EXTRACTION_PROMPT);
  });

  it('passes whole articles to the request and never retries with a shortened input on a context error', async () => {
    const first = `全文开头\n${'全文中段'.repeat(235000)}全文结尾\n`;
    const second = `\n第二篇\n${'另一篇原文'.repeat(5000)}\n`;
    const sampleText = prepareWritingModSamples([{ name: '长篇', text: first }, { name: '短篇', text: second }]);
    completion.mockRejectedValue(new Error('context_length_exceeded'));
    await expect(extractWritingMod({ apiSettings, sampleText, extractionPrompt: '' })).rejects.toThrow('context_length_exceeded');
    expect(completion).toHaveBeenCalledTimes(1);
    const message = completion.mock.calls[0][0].messages[1].content;
    expect(message).toContain(first);
    expect(message).toContain(second);
    expect(message.endsWith(sampleText)).toBe(true);
  });

  it.each(['', '解释而非 JSON', '{}', '{"name":"A","content":" "}', 'null', '{"name":3,"content":"规则"}'])('rejects unusable output: %s', (raw) => {
    expect(() => parseExtractedWritingMod(raw)).toThrow();
  });

  it('does not call the model without a sample and surfaces request failures', async () => {
    await expect(extractWritingMod({ apiSettings, sampleText: ' ', extractionPrompt: '' })).rejects.toThrow('请先');
    expect(completion).not.toHaveBeenCalled();
    completion.mockRejectedValue(new Error('网络失败'));
    await expect(extractWritingMod({ apiSettings, sampleText: '文章', extractionPrompt: '' })).rejects.toThrow('网络失败');
  });
});

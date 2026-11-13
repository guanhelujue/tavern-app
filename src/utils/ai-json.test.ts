import { describe, expect, it } from 'vitest';
import { AiJsonParseError, extractAiJsonArray, extractAiJsonObject, inspectAiJson, parseAiJson, tryParseAiJson } from './ai-json';

describe('ai-json recovery', () => {
  it('preserves exact prose punctuation, quoted dialogue, paths and delimiter-like text', () => {
    const original = { text: '他说：“你好，世界。”\n字面量 ,} ]} \\ C:\\temp\\a', nested: ['[说明]', '｛内容｝：'] };
    expect(parseAiJson(JSON.stringify(original))).toEqual(original);
    expect(parseAiJson('以下是结果：```json\n' + JSON.stringify(original) + '\n```')).toEqual(original);
  });
  it('preserves completed fields and array entries under a truncated object root', () => {
    const result = inspectAiJson('{"title":"已完成","routes":[{"name":"第一条"},{"name":"未完成');
    expect(result.value).toEqual({ title: '已完成', routes: [{ name: '第一条' }] });
    expect(result.status).toBe('partial');
  });
  it('keeps a complete field but drops its unfinished sibling', () => {
    expect(parseAiJson('{"title":"已完成","body":"未完成')).toEqual({ title: '已完成' });
  });
  it('salvages good siblings around an invalid middle array entry', () => {
    const result = inspectAiJson('{"items":[{"id":1}, BROKEN, {"id":3}]}');
    expect(result.value).toEqual({ items: [{ id: 1 }, { id: 3 }] });
    expect(result.status).toBe('partial');
  });
  it('accepts primitive JSON without extracting braces from a string', () => {
    expect(parseAiJson('false')).toBe(false);
    expect(parseAiJson('null')).toBeNull();
    expect(parseAiJson('"{just text}"')).toBe('{just text}');
  });
  it('keeps the first valid array root even when a second object follows', () => {
    expect(parseAiJson('["first"] 后续示例 {"other":true}')).toEqual(['first']);
  });
  it('parses fenced JSON with prose and braces inside strings', () => {
    const value = extractAiJsonObject('结果如下：\n```json\n{"text":"保留 {括号} 和 \\\"引号\\\""}\n```');
    expect(value?.text).toContain('{括号}');
  });
  it('removes trailing comma and repairs structural full-width punctuation', () => {
    expect(extractAiJsonObject('｛“ok”：true，“items”：［1，2，］，｝')).toEqual({ ok: true, items: [1, 2] });
  });
  it('repairs a response truncated after complete string values', () => {
    const inspected = inspectAiJson('{"items":[{"title":"A"},{"title":"B"}');
    expect(inspected.status).toBe('recovered');
    expect(inspected.value).toEqual({ items: [{ title: 'A' }, { title: 'B' }] });
    expect(inspected.diagnostics).toContain('模型回复缺少 JSON 结尾括号，已补齐结构');
  });
  it('does not invent a truncated string value', () => {
    expect(tryParseAiJson('{"title":"半截')).toBeUndefined();
    expect(() => parseAiJson('{"title":"半截')).toThrow(AiJsonParseError);
  });
  it('does not select a nested object when the intended root is malformed', () => {
    expect(extractAiJsonObject('{"items":[{"ok":true}')).toEqual({ items: [{ ok: true }] });
  });
  it('skips a bracketed prose label before the actual object root', () => {
    expect(extractAiJsonObject('[说明] 结果：{"ok":true}')).toEqual({ ok: true });
  });
  it('returns arrays only for an array root', () => {
    expect(extractAiJsonArray('[{"id":1},{"id":2}')).toEqual([{ id: 1 }, { id: 2 }]);
    expect(extractAiJsonArray('{"items":[]}')).toBeNull();
  });
  it('salvages complete array siblings before a truncated final item', () => {
    expect(extractAiJsonArray('[{"id":1},{"id":2},{"id":')).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

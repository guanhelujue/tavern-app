import { describe, expect, it } from 'vitest';

import { parseForecastOutput } from './novel-forecast';

const route = (title: string) => ({
  title, premise: '沿着线索推进',
  beats: [{ chapter: 1, summary: '发现线索' }],
  characterDecisions: [], hookAdvance: [],
  projectedChanges: { characters: [], relationships: [], world: [] },
  risks: [], intentScore: 70, intentRationale: '符合当前目标',
});

describe('forecast JSON recovery', () => {
  it('keeps complete route siblings when the final JSON delimiters were truncated', () => {
    const raw = JSON.stringify({ routes: [route('路线一'), route('路线二')] }).slice(0, -2);
    expect(parseForecastOutput(raw, 3).routes.map((item) => item.title)).toEqual(['路线一', '路线二']);
  });

  it('drops one malformed route without discarding valid routes', () => {
    const raw = JSON.stringify({ routes: [route('路线一'), { title: '损坏' }, route('路线三')] });
    expect(parseForecastOutput(raw, 3).routes.map((item) => item.title)).toEqual(['路线一', '路线三']);
  });
});

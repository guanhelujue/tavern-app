import { describe, expect, it } from 'vitest';

import { compileStoryFoundation } from './blueprint-compiler';
import { createEmptyBlueprint } from './domain';

describe('compileStoryFoundation', () => {
  it('compiles the canonical blueprint without leaking empty optional sections', () => {
    const blueprint = createEmptyBlueprint('一座城市每天忘记一个人');
    blueprint.protagonist.desire = '留下妹妹存在过的证据';
    blueprint.protagonist.obstacle = '所有记录都在消失';
    blueprint.opening = '妹妹的户籍变成白纸';
    blueprint.constraints = ['不要万能系统', '不要梦境结局'];
    blueprint.longForm = {
      engine: '每次潮汐都抹除不同群体的记忆，保存记忆会持续改变城市权力。',
      arcs: ['保存妹妹', '争夺档案权', '重建共同记忆规则'],
      openThreads: ['妹妹为何消失', '旧档案馆秘密', '主角被篡改的童年'],
    };

    const prompt = compileStoryFoundation(blueprint);
    expect(prompt).toContain('【作品定位】');
    expect(prompt).toContain('- 不要万能系统');
    expect(prompt).toContain('【长篇故事引擎】');
    expect(prompt).toContain('2. 争夺档案权');
    expect(prompt).toContain('【长期悬念与副线】');
    expect(prompt).not.toContain('【长期方向】');
  });
});

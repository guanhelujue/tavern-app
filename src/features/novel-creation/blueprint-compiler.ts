import type { StoryBlueprint } from './domain';

export function compileStoryFoundation(blueprint: StoryBlueprint): string {
  const constraints = blueprint.constraints.map((item) => item.trim()).filter(Boolean);
  return [
    `【作品定位】\n${blueprint.premise.trim()}`,
    `【主角核心】\n身份：${blueprint.protagonist.identity.trim() || '待定'}\n欲望：${blueprint.protagonist.desire.trim()}\n核心阻力：${blueprint.protagonist.obstacle.trim()}`,
    blueprint.setting.trim() ? `【世界设定】\n${blueprint.setting.trim()}` : '',
    blueprint.stakes.trim() ? `【失败代价】\n${blueprint.stakes.trim()}` : '',
    `【开篇状态】\n${blueprint.opening.trim()}`,
    blueprint.direction.trim() ? `【长期方向】\n${blueprint.direction.trim()}` : '',
    blueprint.longForm.engine.trim() ? `【长篇故事引擎】\n${blueprint.longForm.engine.trim()}` : '',
    blueprint.longForm.arcs.some((item) => item.trim())
      ? `【阶段推进】\n${blueprint.longForm.arcs.map((item, index) => `${index + 1}. ${item.trim()}`).filter((item) => !item.endsWith('. ')).join('\n')}`
      : '',
    blueprint.longForm.openThreads.some((item) => item.trim())
      ? `【长期悬念与副线】\n${blueprint.longForm.openThreads.map((item) => `- ${item.trim()}`).filter((item) => item !== '- ').join('\n')}`
      : '',
    blueprint.tone.trim() ? `【叙事气质】\n${blueprint.tone.trim()}` : '',
    constraints.length > 0
      ? `【作者约束】\n${constraints.map((item) => `- ${item}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');
}

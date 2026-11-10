import type { StoryBlueprint } from './domain';

export function compileStoryFoundation(blueprint: StoryBlueprint): string {
  const constraints = (blueprint.constraints ?? []).map((item) => item.trim()).filter(Boolean);
  const title = blueprint.title?.trim() ?? '';
  const premise = blueprint.premise?.trim() ?? '';
  const identity = blueprint.protagonist?.identity?.trim() ?? '';
  const desire = blueprint.protagonist?.desire?.trim() ?? '';
  const obstacle = blueprint.protagonist?.obstacle?.trim() ?? '';
  const setting = blueprint.setting?.trim() ?? '';
  const stakes = blueprint.stakes?.trim() ?? '';
  const opening = blueprint.opening?.trim() ?? '';
  const direction = blueprint.direction?.trim() ?? '';
  const tone = blueprint.tone?.trim() ?? '';
  const longForm = blueprint.longForm ?? { engine: '', arcs: [], openThreads: [] };
  const engine = longForm.engine?.trim() ?? '';
  const arcs = (longForm.arcs ?? []).map((item) => item.trim()).filter(Boolean);
  const openThreads = (longForm.openThreads ?? []).map((item) => item.trim()).filter(Boolean);
  return [
    title ? `【世界名称】\n${title}` : '',
    premise ? `【作品定位】\n${premise}` : '',
    identity || desire || obstacle
      ? `【主角核心】\n${identity ? `身份：${identity}` : ''}${desire ? `\n欲望：${desire}` : ''}${obstacle ? `\n核心阻力：${obstacle}` : ''}`
      : '',
    setting ? `【世界设定】\n${setting}` : '',
    stakes ? `【失败代价】\n${stakes}` : '',
    opening ? `【开篇状态】\n${opening}` : '',
    direction ? `【长期方向】\n${direction}` : '',
    engine ? `【长篇故事引擎】\n${engine}` : '',
    arcs.length > 0 ? `【阶段推进】\n${arcs.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    openThreads.length > 0 ? `【长期悬念与副线】\n${openThreads.map((item) => `- ${item}`).join('\n')}` : '',
    tone ? `【叙事气质】\n${tone}` : '',
    constraints.length > 0
      ? `【作者约束】\n${constraints.map((item) => `- ${item}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');
}

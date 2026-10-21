/** Character portrait display and generation helpers. */

import { resolveNovelImageUri } from './novel-images';

/** Resolve a character-owned file/data image for display. Empty means no portrait. */
export function resolvePortraitDisplayUri(
  portraitUri?: string | null,
  _gender?: string | null,
): string {
  return resolveNovelImageUri(portraitUri)?.trim() || '';
}

export type CharacterPortraitPromptInput = {
  name?: string | null;
  age?: string | null;
  height?: string | null;
  weight?: string | null;
  bodyFat?: string | null;
  appearance?: string | null;
};

export type CharacterPortraitShootInput = {
  outfit?: string | null;
  action?: string | null;
};

export type CharacterPortraitStyleId =
  | 'auto'
  | 'documentary'
  | 'cinematic'
  | 'editorial'
  | 'painterly'
  | 'anime'
  | 'ink'
  | 'noir'
  | 'analog';

export type CharacterPrivatePortraitSceneId =
  | 'auto'
  | 'shower-swimwear'
  | 'bathrobe'
  | 'onsen'
  | 'beach-sunbathing'
  | 'bedroom-aftercare';

export const CHARACTER_PORTRAIT_STYLES: {
  id: CharacterPortraitStyleId;
  label: string;
  prompt: string;
}[] = [
  { id: 'auto', label: '自动真人摄影', prompt: '' },
  { id: 'documentary', label: '真人纪实', prompt: '真人环境肖像摄影，像摄影师在真实地点为普通人拍摄的原始照片；自然曝光、可信透视、不过度布光，皮肤保留毛孔、细纹、痣、轻微泛红和自然不对称，头发与衣料具有真实随机细节' },
  { id: 'cinematic', label: '电影写实', prompt: '真人出演的电影剧照摄影，真实相机与真实镜头光学，皮肤保留毛孔、细纹和自然色差，拒绝插画感、CG 感与蜡像质感' },
  { id: 'editorial', label: '真人时装摄影', prompt: '真人时装杂志摄影，真实模特、真实布料和真实摄影棚光线，构图与服装轮廓鲜明，但不把人物处理成插画、3D 模型或游戏原画' },
  { id: 'painterly', label: '厚涂概念', prompt: '叙事型数字厚涂与概念设计，有可见笔触、材质分层和环境色反射，像高预算游戏角色原画但不做模板立绘' },
  { id: 'anime', label: '动画关键帧', prompt: '精致动画电影关键帧，有明确造型语言、细腻表情和环境叙事，避免通用二次元网红脸和塑料般光滑上色' },
  { id: 'ink', label: '当代岩彩', prompt: '当代工笔岩彩与水墨绘画融合，纸张肌理、矿物色层和留白参与构图，人物仍保持清晰具体的现代角色设计' },
  { id: 'noir', label: '黑色电影摄影', prompt: '真人出演的黑色电影剧照摄影，硬边光、深阴影、真实胶片颗粒与光影切面塑造性格，保留真实皮肤和镜头成像' },
  { id: 'analog', label: '真人胶片摄影', prompt: '真人 35mm 胶片人像摄影，自然颗粒、轻微偏色、现场光和不过度摆拍的瞬间感，像人物真实生活中被相机捕捉到的一帧' },
];

export const CHARACTER_PRIVATE_PORTRAIT_SCENES: {
  id: CharacterPrivatePortraitSceneId;
  label: string;
  prompt: string;
}[] = [
  { id: 'auto', label: '不预设场景', prompt: '' },
  {
    id: 'shower-swimwear',
    label: '泳装淋浴',
    prompt: '单人盥洗室里的运动后冲洗：人物穿完整、不透明的泳裤或泳装，湿发、水珠、瓷砖和玻璃水汽保持真实凌乱；画面像同行者用普通相机记录的自然瞬间，泳装覆盖保持端正自然',
  },
  {
    id: 'bathrobe',
    label: '浴袍浴室',
    prompt: '安静的酒店盥洗空间：人物穿系带端正的长款棉质居家外套，肩颈和小腿自然入画，镜面、普通暖灯和随手放置的旅行物品记录归来后的松弛状态，像未经精修的旅行随拍',
  },
  {
    id: 'onsen',
    label: '雾气温泉',
    prompt: '度假村户外热汤池随拍：人物穿完整不透明的运动泳装并处在较高水位中，以背面或四分之三侧面构图，真实雾气、岩石和水面形成自然遮挡，保留现场湿度、噪点和不完全均匀的光线',
  },
  {
    id: 'beach-sunbathing',
    label: '海滩日光浴',
    prompt: '安静无人的海滩日光浴记录：人物穿设计简洁的完整不透明运动泳装，以背面或远景侧身出现；海风、岩石、树影和逆光营造自由感，整体保持主流旅行杂志尺度',
  },
  {
    id: 'bedroom-aftercare',
    label: '卧室晨昏',
    prompt: '卧室清晨或深夜的休息瞬间：人物穿完整不透明的睡衣或宽松衬衫，以床沿、使用过的被褥和窗帘构成自然层次，像熟人随手拍下的普通生活照片而不是家居广告',
  },
];

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function visualAt(values: string[], hash: number, offset: number) {
  return values[(hash + offset) % values.length];
}

function resolvePortraitStyle(
  styleId: CharacterPortraitStyleId,
) {
  if (styleId !== 'auto') {
    return CHARACTER_PORTRAIT_STYLES.find((item) => item.id === styleId)
      ?? CHARACTER_PORTRAIT_STYLES[1];
  }
  // “自动”固定采用真人纪实摄影。镜头、动作和环境仍会变化，但媒介不再
  // 随机漂移到电影概念图、动画或厚涂。其他画风只在用户手动选择时启用。
  return CHARACTER_PORTRAIT_STYLES.find((item) => item.id === 'documentary')
    ?? CHARACTER_PORTRAIT_STYLES[1];
}

function isPhotographicStyle(styleId: CharacterPortraitStyleId) {
  return !['painterly', 'anime', 'ink'].includes(styleId);
}

function promptValue(value?: string | null) {
  return value?.trim() || '未设定';
}

/** Build a readable, card-safe portrait prompt from the current character draft. */
export function buildCharacterPortraitPrompt(
  character: CharacterPortraitPromptInput,
  shoot?: CharacterPortraitShootInput,
  styleId: CharacterPortraitStyleId = 'auto',
  variation = 0,
) {
  const outfit = shoot?.outfit?.trim();
  const action = shoot?.action?.trim();
  const hash = stableHash([
    character.name,
    character.age,
    character.height,
    character.weight,
    character.bodyFat,
    character.appearance,
    variation,
  ].join('|'));
  const style = resolvePortraitStyle(styleId);
  const photographic = isPhotographicStyle(styleId);
  const composition = visualAt([
    '平视全身构图，人物从头顶到鞋尖完整入画，使用正常焦段和可信透视，背景保持普通、自然',
    '略微偏离画面中心的全身构图，头、手、腿和鞋完整可见，一侧保留安静负空间',
    '稍宽的环境全身构图，人物身体比例准确，周围只保留少量真实生活细节',
  ], hash, variation * 7);
  const lighting = visualAt([
    '阴天自然光，曝光克制，面部没有磨皮，暗部仍保留真实噪点和细节',
    '傍晚自然环境光，白平衡略带现场色温，不做橙青电影调色',
    '室内窗光与现有灯具共同照明，允许轻微曝光不均，面部信息完整',
  ], hash, variation * 11 + 3);

  return [
    photographic
      ? '生成一张未经精修的竖幅全身人物照片。'
      : '生成一张竖幅全身人物图像。',
    `姓名：${promptValue(character.name)}。`,
    `年龄：${promptValue(character.age)}。`,
    `身高：${promptValue(character.height)}。体重：${promptValue(character.weight)}。体脂：${promptValue(character.bodyFat)}。`,
    `长相与五官：${promptValue(character.appearance)}。`,
    outfit ? `本次穿搭：${outfit}。` : '',
    action ? `本次动作：${action}。` : '',
    `视觉媒介：${style.label}。${style.prompt}。`,
    styleId === 'auto'
      ? '使用普通相机的自然成像：可信透视、自然肤质、真实头发和衣料细节，不进行商业美妆精修。'
      : '',
    `构图：${composition}。光线：${lighting}。`,
    photographic
      ? '保持普通纪实摄影的自然质感，避免过度磨皮、夸张妆造和刻意摆拍。'
      : '',
    `要求：竖幅单人全身${photographic ? '照片' : '图像'}，从头顶到鞋尖完整入画；无文字、无水印、无 logo、无边框、无多余人物。`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Build a separate, provider-safe lifestyle-photo prompt for the private slot.
 */
export function buildCharacterPrivatePortraitPrompt(
  character: CharacterPortraitPromptInput,
  shoot?: CharacterPortraitShootInput,
  styleId: CharacterPortraitStyleId = 'auto',
  variation = 0,
  sceneId: CharacterPrivatePortraitSceneId = 'auto',
) {
  const outfit = shoot?.outfit?.trim();
  const action = shoot?.action?.trim();
  const hash = stableHash([
    'private-photo',
    character.name,
    character.age,
    character.height,
    character.weight,
    character.bodyFat,
    character.appearance,
    variation,
  ].join('|'));
  const style = resolvePortraitStyle(styleId);
  const photographic = isPhotographicStyle(styleId);
  const directedScene = CHARACTER_PRIVATE_PORTRAIT_SCENES.find((item) => item.id === sceneId);
  const composition = directedScene?.prompt?.trim();
  const lighting = visualAt([
    '单盏床头灯形成安静的暖色光池，暗部保留织物与轮廓细节',
    '清晨窗帘透光，低对比度、轻颗粒，像未经摆拍的胶片照片',
    '室内泳池休息区的柔雾与侧逆光，布料纹理和人物轮廓保持清楚自然',
    '夜晚城市反光掠过室内，面部和手部获得克制的局部亮度',
    '柔和棚拍光配合深色背景，强调人物神态、衣物层次和身体姿态',
  ], hash, variation * 11 + 3);

  return [
    photographic
      ? '生成一张未经精修的竖幅单人生活照片。'
      : '生成一张竖幅单人生活场景图像。',
    `姓名：${promptValue(character.name)}。`,
    `年龄：${promptValue(character.age)}。`,
    `身高：${promptValue(character.height)}。体重：${promptValue(character.weight)}。体脂：${promptValue(character.bodyFat)}。`,
    `长相与五官：${promptValue(character.appearance)}。`,
    outfit ? `本次穿搭：${outfit}。` : '',
    action ? `本次动作：${action}。` : '',
    `视觉媒介：${style.label}。${style.prompt}。`,
    styleId === 'auto'
      ? '使用普通相机的自然成像：可信透视、自然肤质、真实头发和衣料细节，不进行商业美妆精修。'
      : '',
    composition ? `用户选择的生活场景：${composition}。` : '',
    `光线：${lighting}。`,
    '身份锁定：如果请求中附带公开参考图，该图就是人物身份的唯一事实来源，而不是仅供取色或构图的风格参考。必须保持同一张脸、相同骨相、脸型、五官比例、眼型与眼距、鼻形、唇形、发际线、发色、肤色、年龄观感和体格；只改变服装、姿势、环境、光线与镜头。不得重新选角、换脸、融合另一张脸或把人物美化成另一种网红脸。参考图若为真人照片，结果也必须保持真人照片媒介。',
    '发布尺度：画面必须适合公开的运动、居家或旅行杂志。服装必须完整、不透明、穿着端正；可以使用长款居家外套、运动泳装、高水位、蒸汽、背面姿态、前景物或阴影组织构图。镜头关注人物身份、表情和环境，不拍摄躯干局部特写。',
    photographic
      ? '保持普通纪实摄影的自然质感，避免过度磨皮、夸张妆造和刻意摆拍。'
      : '',
    `要求：竖幅单人${photographic ? '照片' : '图像'}，人物身份可辨、五官稳定；无文字、无水印、无 logo、无边框、无多余人物。避免畸形肢体、重复手指、塑料皮肤和过度磨皮。`,
  ]
    .filter(Boolean)
    .join('\n');
}

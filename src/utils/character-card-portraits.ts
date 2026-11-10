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

/** Stable private-body facts from dossierV2.private, used only by private photos. */
export type CharacterPrivatePortraitBody = {
  variant?: 'male' | 'female';
  penis?: string | null;
  testiclesAndPubicHair?: string | null;
  breastsAndBody?: string | null;
  vulva?: string | null;
  vagina?: string | null;
  anus?: string | null;
  intimateBody?: string | null;
};

export type CharacterPrivatePortraitPromptInput = CharacterPortraitPromptInput & {
  privateBody?: CharacterPrivatePortraitBody | null;
};

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

function promptValue(value?: string | null) {
  return value?.trim() || '未设定';
}

function privateBodyLines(body?: CharacterPrivatePortraitBody | null) {
  if (!body) return [];
  const fields: [string, string | null | undefined][] = body.variant === 'female'
    ? [
        ['胸部与身体', body.breastsAndBody],
        ['外阴与阴蒂', body.vulva],
        ['阴道', body.vagina],
        ['肛门与会阴', body.anus],
      ]
    : [
        ['阴茎', body.penis],
        ['睾丸、阴囊与阴毛', body.testiclesAndPubicHair],
        ['肛门与会阴', body.anus],
        ['其他私密身体', body.intimateBody],
      ];
  return fields
    .map(([label, value]) => [label, value?.trim()] as const)
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `私密身体·${label}：${value}。`);
}

/** Build a readable, card-safe portrait prompt from the current character draft. */
export function buildCharacterPortraitPrompt(
  character: CharacterPortraitPromptInput,
  shoot?: CharacterPortraitShootInput,
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
    '生成一张未经精修的竖幅全身真人摄影照片。',
    `姓名：${promptValue(character.name)}。`,
    `年龄：${promptValue(character.age)}。`,
    `身高：${promptValue(character.height)}。体重：${promptValue(character.weight)}。体脂：${promptValue(character.bodyFat)}。`,
    `长相与五官：${promptValue(character.appearance)}。`,
    outfit ? `本次穿搭：${outfit}。` : '',
    action ? `本次动作：${action}。` : '',
    '使用普通相机的自然成像：可信透视、自然肤质、真实头发和衣料细节，不进行商业美妆精修。',
    `构图：${composition}。光线：${lighting}。`,
    '保持普通纪实摄影的自然质感，避免过度磨皮、夸张妆造和刻意摆拍。',
    `要求：竖幅单人全身照片，从头顶到鞋尖完整入画；无文字、无水印、无 logo、无边框、无多余人物。`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Build a separate private-photo prompt from the authored private body fields.
 */
export function buildCharacterPrivatePortraitPrompt(
  character: CharacterPrivatePortraitPromptInput,
  shoot?: CharacterPortraitShootInput,
  variation = 0,
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
  const bodyLines = privateBodyLines(character.privateBody);
  const lighting = visualAt([
    '柔和的现场光，曝光克制，暗部保留真实细节与轻颗粒',
    '自然窗光，低对比度、轻颗粒，像未经摆拍的现场照片',
    '侧逆光勾勒人物轮廓，光线不过度均匀，保留真实肤色',
    '夜晚环境的反射光，面部和手部获得克制的局部亮度',
    '柔和棚拍光配合深色背景，强调人物神态、衣物层次和身体姿态',
  ], hash, variation * 11 + 3);

  return [
    '生成一张未经精修的竖幅单人真人摄影生活照片。',
    `姓名：${promptValue(character.name)}。`,
    `年龄：${promptValue(character.age)}。`,
    `身高：${promptValue(character.height)}。体重：${promptValue(character.weight)}。体脂：${promptValue(character.bodyFat)}。`,
    `长相与五官：${promptValue(character.appearance)}。`,
    outfit ? `本次穿搭：${outfit}。` : '',
    action ? `本次动作：${action}。` : '',
    ...bodyLines,
    '使用普通相机的自然成像：可信透视、自然肤质、真实头发和衣料细节，不进行商业美妆精修。',
    '脸部参考：如果请求中附带参考图，该图只用于锁定脸部身份，不是服装、姿势或构图参考。必须保持脸型、骨相、五官比例、眼型与眼距、鼻形、唇形以及面部肤色和特征一致；发型、发色、服装、配饰、姿势、动作、体态、体格、年龄观感与场景均不要求相同，可按当前画面重新设计。不得重新选角、换脸、融合另一张脸或把人物处理成另一种网红脸。',
    '构图：单人竖幅生活摄影，人物自然入画，背景保持真实生活空间，不做刻意摆拍。',
    '私密呈现：按上述私密身体字段如实呈现，不回避、不淡化，也不临时添加未记录的器官、尺寸或身体特征。',
    `光线：${lighting}。`,
    '保持普通纪实摄影的自然质感，避免过度磨皮、夸张妆造和刻意摆拍。',
    `要求：竖幅单人真人照片，人物身份可辨、五官稳定；无文字、无水印、无 logo、无边框、无多余人物。避免畸形肢体、重复手指、塑料皮肤和过度磨皮。`,
  ]
    .filter(Boolean)
    .join('\n');
}

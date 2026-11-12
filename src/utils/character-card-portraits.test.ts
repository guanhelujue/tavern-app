import { describe, expect, it, vi } from 'vitest';

import {
  buildCharacterPortraitPrompt,
  buildCharacterPrivatePortraitPrompt,
} from './character-card-portraits';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  documentDirectory: null,
}));
vi.mock('expo-image-picker', () => ({}));

const character = {
  name: '沈砚舟',
  gender: '男',
  age: '28',
  height: '184cm',
  weight: '78kg',
  bodyFat: '13%',
  profession: '旧城刑警',
  appearance: '窄眼，短黑发，左眉有一道浅疤，常穿旧皮夹克',
  personality: '谨慎、寡言，但对弱者有保护欲',
  worldName: '雾港',
  worldEra: '1990年代架空城市',
  worldTone: '犯罪悬疑，潮湿压抑',
};

const malePrivateCharacter = {
  ...character,
  privateBody: {
    variant: 'male' as const,
    penis: '包皮环切，肤色偏深，左侧有一处浅色小痣',
    testiclesAndPubicHair: '左右略不对称，阴毛修剪短而整齐',
    anus: '色泽偏浅，健康，无明显疤痕',
    intimateBody: '胸口有浅色痣，体味清淡',
  },
};

describe('character portrait visual direction', () => {
  it('uses only stable visible identity facts and leaves outfit and action empty', () => {
    const prompt = buildCharacterPortraitPrompt(character);

    expect(prompt).toContain('姓名：沈砚舟');
    expect(prompt).toContain('年龄：28');
    expect(prompt).toContain('身高：184cm');
    expect(prompt).toContain('体重：78kg');
    expect(prompt).toContain('体脂：13%');
    expect(prompt).toContain(`长相与五官：${character.appearance}`);
    expect(prompt).not.toContain(character.profession);
    expect(prompt).not.toContain(character.personality);
    expect(prompt).not.toContain(character.worldName);
    expect(prompt).not.toContain('本次穿搭：');
    expect(prompt).not.toContain('本次动作：');
    expect(prompt).not.toContain('性格转译');
    expect(prompt).not.toContain('人物差异化');
  });

  it('adds outfit and action only when the user supplies them', () => {
    const prompt = buildCharacterPortraitPrompt(
      character,
      { outfit: '灰色连帽衫和旧牛仔裤', action: '站在窗边低头翻书' },
    );

    expect(prompt).toContain('本次穿搭：灰色连帽衫和旧牛仔裤');
    expect(prompt).toContain('本次动作：站在窗边低头翻书');
  });

  it('is deterministic for the same character and variation', () => {
    expect(buildCharacterPortraitPrompt(character, undefined, 2))
      .toBe(buildCharacterPortraitPrompt(character, undefined, 2));
  });

  it('changes the directed shot when reshuffling composition', () => {
    expect(buildCharacterPortraitPrompt(character, undefined, 0))
      .not.toBe(buildCharacterPortraitPrompt(character, undefined, 1));
  });

  it('locks public and private images to real photography with no visual-medium field', () => {
    for (let variation = 0; variation < 8; variation += 1) {
      const publicPrompt = buildCharacterPortraitPrompt(character, undefined, variation);
      const privatePrompt = buildCharacterPrivatePortraitPrompt(
        malePrivateCharacter,
        undefined,
        variation,
      );

      expect(publicPrompt).toContain('真人摄影照片');
      expect(privatePrompt).toContain('真人摄影生活照片');
      expect(publicPrompt).toContain('普通相机的自然成像');
      expect(privatePrompt).toContain('普通相机的自然成像');
      for (const prompt of [publicPrompt, privatePrompt]) {
        expect(prompt).not.toContain('视觉媒介');
        expect(prompt).not.toMatch(/厚涂概念|动画关键帧|当代岩彩|数字厚涂|二次元/);
      }
    }
  });

  it('concatenates the authored private body fields into the private prompt', () => {
    const prompt = buildCharacterPrivatePortraitPrompt(malePrivateCharacter);

    expect(prompt).toContain('私密身体·阴茎：包皮环切，肤色偏深，左侧有一处浅色小痣。');
    expect(prompt).toContain('私密身体·睾丸、阴囊与阴毛：左右略不对称，阴毛修剪短而整齐。');
    expect(prompt).toContain('私密身体·肛门与会阴：色泽偏浅，健康，无明显疤痕。');
    expect(prompt).toContain('私密身体·其他私密身体：胸口有浅色痣，体味清淡。');
  });

  it('uses the female private field set for female characters', () => {
    const prompt = buildCharacterPrivatePortraitPrompt({
      ...character,
      privateBody: {
        variant: 'female',
        breastsAndBody: '乳房大小适中，乳头颜色偏浅',
        vulva: '外阴色泽浅，阴毛稀疏',
        vagina: '健康，无异常',
        anus: '色泽自然，健康',
      },
    });

    expect(prompt).toContain('私密身体·胸部与身体：乳房大小适中，乳头颜色偏浅。');
    expect(prompt).toContain('私密身体·外阴与阴蒂：外阴色泽浅，阴毛稀疏。');
    expect(prompt).toContain('私密身体·阴道：健康，无异常。');
    expect(prompt).toContain('私密身体·肛门与会阴：色泽自然，健康。');
    expect(prompt).not.toContain('私密身体·阴茎');
  });

  it('no longer ships preset private scenes or moderation-safe clothing locks', () => {
    const prompt = buildCharacterPrivatePortraitPrompt(malePrivateCharacter);

    for (const scene of ['泳装淋浴', '浴袍浴室', '雾气温泉', '海滩日光浴', '卧室晨昏']) {
      expect(prompt).not.toContain(scene);
    }
    expect(prompt).not.toContain('服装必须完整、不透明');
    expect(prompt).not.toContain('发布尺度');
  });

  it('asks only for facial identity when a reference image is attached', () => {
    const prompt = buildCharacterPrivatePortraitPrompt(malePrivateCharacter);

    expect(prompt).toContain('只用于锁定脸部身份');
    expect(prompt).toContain('发型、发色、服装、配饰、姿势、动作、体态、体格、年龄观感与场景均不要求相同');
    expect(prompt).not.toContain('相同骨相、脸型、五官比例、眼型与眼距、鼻形、唇形、发际线、发色、肤色、年龄观感和体格');
  });
});

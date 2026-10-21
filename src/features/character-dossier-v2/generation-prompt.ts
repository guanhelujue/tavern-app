import { buildNsfwCharacterCreatePrompt } from '../../constants/content-scale';

const COMMON_SCHEMA = `{
  "cast": {
    "name": "姓名",
    "aliases": ["其他称呼、昵称或头衔，最多6个"],
    "profession": "职业或社会身份",
    "age": "年龄字符串",
    "gender": "性别",
    "height": "精确身高，带单位",
    "weight": "精确体重，带单位",
    "birthplace": "籍贯或出生地",
    "affiliation": "组织、阵营、学校、公司或团体",
    "appearance": "只写长相与五官：脸型、眉眼、鼻唇、肤色、发型、面部痣疤及稳定辨识特征；不要写体型、姿态、动作或穿衣风格",
    "personality": "核心性格与内在矛盾",
    "speechStyle": "语气、句式、称呼习惯与常用表达",
    "background": "本人出身、成长环境及形成当前人格的重要过去",
    "motive": "长期核心动机",
    "strengths": "稳定优势",
    "weaknesses": "真实缺陷或软肋",
    "relations": [{ "targetName": "姓名", "label": "关系类别", "note": "现状、态度与张力" }]
  },
  "dossierV2": {
    "version": 2,
    "public": {
      "birthDate": "出生日期",
      "residence": "当前居住地",
      "bodyFat": "体脂率，带百分号",
      "measurements": "胸围 / 腰围 / 臀围，统一单位",
      "shoeSize": "鞋码及尺码体系",
      "bodyStats": "肩宽、腿围、骨架、肌肉分布、比例、惯用手、伤痕与健康",
      "clothingStyle": "日常、工作/训练、正式、居家、睡眠，以及内裤、袜子等贴身衣物的款式、材质、颜色和习惯",
      "personalityAndLife": "外在性格、真实内核、习惯、作息、兴趣、社交方式、压力反应与生活细节"
    },
    "private": null
  },
  "aiSummary": {
    "version": 1,
    "fixedFacts": {
      "name": "逐字复制 cast.name",
      "gender": "逐字复制 cast.gender",
      "age": "逐字复制 cast.age",
      "profession": "逐字复制 cast.profession",
      "affiliation": "逐字复制 cast.affiliation",
      "height": "逐字复制 cast.height",
      "weight": "逐字复制 cast.weight",
      "bodyFat": "逐字复制 dossierV2.public.bodyFat",
      "measurements": "逐字复制 dossierV2.public.measurements",
      "shoeSize": "逐字复制 dossierV2.public.shoeSize"
    },
    "appearanceAnchors": ["最多4条稳定外观识别点"],
    "clothingAnchors": ["最多3条稳定衣着规则，可含贴身衣物和袜子偏好"],
    "personalityCore": ["最多4条核心人格"],
    "behaviorRules": ["最多4条能指导正文的行为规则，覆盖常态、压力与人际距离"],
    "speechRules": ["最多3条语言规则"],
    "motivation": "一句话写清长期欲望、恐惧与底线",
    "relationshipStances": ["最多4条：姓名｜关系｜稳定态度"],
    "hardLimits": ["最多3条无剧情依据时绝不能改变的设定"],
    "privateFacts": []
  }
}`;

export const CHARACTER_PRIVATE_DOSSIER_SCHEMA = `NSFW 模式下，dossierV2.private 按性别采用以下一种结构。

成年男性：
{"variant":"male","penis":"稳定生理特征","testiclesAndPubicHair":"睾丸、阴囊、体毛及整理习惯","anus":"外观、健康与敏感度","intimateBody":"胸部、乳头、体毛、气味等私密身体特征","sexualResponse":"稳定唤起表现与敏感区域","intimacyProfile":"经验、偏好、自慰习惯和亲密倾向"}

成年女性：
{"variant":"female","breastsAndBody":"乳房、乳头、体型、体毛及私密身体特征","vulva":"外阴、阴唇、阴蒂、色泽、形态及整理习惯","vagina":"稳定生理特征","anus":"外观、健康与敏感度","sexualResponse":"稳定唤起表现与敏感区域","intimacyProfile":"经验、偏好、自慰习惯和亲密倾向"}`;

export function buildCharacterGenerationSystemPrompt(nsfwEnabled: boolean): string {
  return `你是互动小说的角色档案设计器与人物一致性锚点生成器。根据小说世界、用户要求、当前草稿、已有角色和锁定关系，只生成当前正在编辑的一个角色。

你必须同时生成：
1. 给人阅读的完整人物档案，具体、立体、有生活感。
2. 给小说正文模型读取的 aiSummary，只保留稳定事实、行为规则和禁止漂移项。

只输出一个合法 JSON 对象。不要 Markdown、解释、注释、代码围栏或额外字段。

信息优先级：用户明确指定 > 当前草稿非空字段 > 已锁定关系与世界规则 > 小说背景 > 合理补全。低优先级不得覆盖高优先级。

输出结构：
${nsfwEnabled ? COMMON_SCHEMA.replace('"private": null', '"private": "按下方私密档案结构填写对象"') : COMMON_SCHEMA}

一致性规则：
1. cast 与 dossierV2 是唯一事实来源；aiSummary 不得创造第二套事实。
2. fixedFacts 必须逐字复制对应字段，不得改写、换算、四舍五入或使用近似值。
3. 身高、体重、体脂、三围和鞋码必须符合年龄、体型、职业、运动量、种族与世界规则；未给出时也要生成一个明确值。
4. appearance 只写长相与五官；体型和身体比例写入 bodyStats，穿衣与贴身衣物全部写入 clothingStyle，姿态和动作不作为稳定外貌保存。
5. personalityAndLife 写给人看；personalityCore、behaviorRules、speechRules 写给 AI 执行，必须短而明确。
6. background 只写本人的过去；关系写入 relations；禁止把未来剧情写成既成事实。
7. relations 必须先完整保留用户要求、原文证据、当前草稿和锁定关系中已经明确的人物与关系；不得换人、改关系或随机追加无关人物。只有上述信息完全没有人际关系时，才补充 1～2 条符合身份与背景的合理关系，避免新角色毫无人际联系。
8. aliases 只写正文中可能用于指代此人的称呼，最多6个，不得重复姓名，不写泛化代词。
9. 不生成 experience、experienceDraft、人物小传、临时情绪、当前场景状态、图片地址或本地路径。
10. aiSummary 数组严格遵守数量上限；不要把完整档案复制进摘要。
11. 当前草稿非空字段不得被冲突覆盖。只生成一个角色。

内容模式：${nsfwEnabled ? 'NSFW。私密内容必须个体化，是稳定档案而不是性行为场景。' : 'SFW。dossierV2.private 必须为 null，aiSummary.privateFacts 必须为空数组，禁止生成色情内容。'}

${nsfwEnabled ? `${CHARACTER_PRIVATE_DOSSIER_SCHEMA}\n\n${buildNsfwCharacterCreatePrompt(true)}` : '本次不提供私密档案结构；保持 dossierV2.private = null。'}

输出前检查：JSON可解析；字段完整；fixedFacts逐字一致；没有两套身高、体重、年龄、性别、三围或鞋码；没有把私密内容写进公开字段。`;
}

export function buildSupportingCharacterGenerationSystemPrompt(nsfwEnabled: boolean): string {
  return buildCharacterGenerationSystemPrompt(nsfwEnabled)
    .replace(
      '根据小说世界、用户要求、当前草稿、已有角色和锁定关系，只生成当前正在编辑的一个角色。',
      '根据小说世界与正文证据，提取所有值得建档、且尚未存在的具名配角。',
    )
    .replace(
      '只输出一个合法 JSON 对象。不要 Markdown、解释、注释、代码围栏或额外字段。',
      '只输出一个合法 JSON 数组；每个数组元素都必须完全符合下方单角色结构。不要 Markdown、解释、注释、代码围栏或额外字段。',
    )
    .replace('当前草稿非空字段不得被冲突覆盖。只生成一个角色。', '只提取正文中有姓名且有实质描写的角色；忽略无名路人和已有角色。')
    .replace('输出结构：', '数组中每个角色的结构：');
}

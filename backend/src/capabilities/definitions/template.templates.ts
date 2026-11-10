/**
 * 写真模板数据（2026-11-10）。
 *
 * 模板是能力定义的一部分：`prompt` 是提交给模型的风格描述主体，
 * `thumbFile` 是列表卡片的预览图。缩略图存放在本仓库
 * `frontend/public/templates/wedding/`，运行时不请求任何外部站点。
 *
 * 当前 10 套龙凤褂中式写真，图片与提示词提取自微信公众号文章
 * `https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw`。
 *
 * 来源记录见 `docs/template-design.md` §5。
 */
/** 模板来源（接口回显用；每条模板自身仍带 `sourceUrl`）。 */
export const TEMPLATE_SOURCE_URL = 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw';
export const TEMPLATE_CAPTURED_AT = '2026-11-10T00:00:00.000Z';
export const TEMPLATE_ASSET_DIR = '/templates/wedding';

export const TEMPLATE_CATEGORIES = [
  { id: 'wedding', label: '婚纱写真' },
  { id: 'studio', label: '纯色棚拍' },
  { id: 'interior', label: '室内布景' },
  { id: 'outdoor', label: '户外庭院' },
] as const;

export type TemplateCategoryId = (typeof TEMPLATE_CATEGORIES)[number]['id'];

export interface PortraitTemplate {
  id: string;
  name: string;
  categoryIds: readonly TemplateCategoryId[];
  /** 列表展示、并作为模型提示词主体的风格描述 */
  prompt: string;
  /** 列表卡片预览图（本站静态资源相对路径） */
  thumbFile: string;
  sourceUrl: string;
}

export const PORTRAIT_TEMPLATES = [
  {
    id: 'longfeng-01',
    name: '红墙团扇',
    categoryIds: ['wedding', 'studio'],
    prompt:
      '竖版中近景人像写真，85mm定焦镜头，f/2.8大光圈浅景深，主体为身着金色织锦中式嫁衣的女性，嫁衣饰有立体凤凰刺绣，金色盘发搭配流苏金饰，手持刺绣团扇，团扇坠浅色流苏，坐姿优雅，视线正对镜头；背景为纯红色哑光墙面，左侧中式木桌上铺红色缎面餐布，餐布绣双喜纹样，摆黑色花器插红色仿真花簇；商业时尚写真风格，前侧方柔光主光源，勾勒衣物织纹与发饰金属光泽，阴影过渡自然，色彩以浓郁正红与暖金为主，饱和度高对比度强，发丝纹理、嫁衣织缎肌理、刺绣针脚清晰可见，构图稳定对称，视觉焦点集中于人物与团扇',
    thumbFile: '/templates/wedding/longfeng-01-red-wall-fan.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-02',
    name: '双喜砖墙',
    categoryIds: ['wedding', 'interior'],
    prompt:
      '竖版中景商业写真，中焦镜头，f/4浅景深，对焦于贴红色双喜的男子与持团扇的女子，侧逆光暖金色电影级光影，墙壁为带斑驳痕迹的老旧米色砖墙，背景是带几何花纹的中式八角木窗；男性着黑色暗纹中式长衫，动作是粘贴红色剪纸双喜，女性穿金红织锦龙凤褂，手持红色刺绣团扇，视线望向男性，氛围温婉；画面主色调为暖金红系，复古胶片质感，细节含布料纹理、砖墙壁化痕迹、光影层次与真实皮肤质感，无夸张失真，具传统中式婚照的高级氛围感',
    thumbFile: '/templates/wedding/longfeng-02-double-happiness-wall.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-03',
    name: '东方情侣',
    categoryIds: ['wedding', 'interior'],
    prompt:
      '竖版商业写真摄影，中近景构图，暖调东方美学风格，画面主体为一对姿态自然的情侣，女性身着绣有金色凤凰纹样的红色中式裙褂，裙褂面料带有精致提花纹理，搭配金色流苏发饰与耳饰，姿态为一手叉腰、另一手轻抬至男性下巴处；男性身着黑色立领盘扣中式西装，姿态为双手背在身后；背景为红金色系花叶装饰与带有竹子纹理的复古墙面，左侧摆放着插有绿植的绿色花瓶，采用柔和侧光与轮廓光照明，光影过渡自然，细节超清，服装刺绣、面料纹理、发丝发丝质感、绿植叶片细节清晰，背景适度虚化突出主体，整体为高级杂志大片质感，色彩饱和统一，暖调氛围浓郁。',
    thumbFile: '/templates/wedding/longfeng-03-oriental-couple.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-04',
    name: '屏风双喜',
    categoryIds: ['wedding', 'interior'],
    prompt:
      '竖版构图，中景，商业时尚写真，主体为一对年轻男女，并排站立，各自手持红色纸质双喜，对焦于人物与道具，背景是深棕色木质屏风，带有圆形镂空区域，内部印有竹纹图案，右上角点缀红色装饰花；女士身着绣满金色龙凤纹样的中式嫁衣，布料带有精致光泽，头戴金色中式发饰，发丝整齐；男士身着黑色中式立领西装，搭配金属盘扣，服装材质挺括；画面采用柔光主光源，辅以柔和轮廓光，阴影过渡自然，色彩以金、红、黑为主，饱和度适中，色调高级，具备商业级超清细节，可见刺绣纹理、布料质感、真实皮肤细节，背景适当虚化，景深控制合理，整体呈现新中式高级国潮写真风格，真实摄影质感，细节丰富无失真',
    thumbFile: '/templates/wedding/longfeng-04-screen-double-happiness.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-05',
    name: '温婉团扇',
    categoryIds: ['wedding', 'interior'],
    prompt:
      '竖版近景构图，商业写真风格，主体为一对身着中式礼服的情侣，女子着红金刺绣中式嫁衣，绣有龙凤纹样，搭配精致金色发饰，单手持装饰花团扇，发型盘起，姿态温婉低头；男子着黑色中式立领唐装，侧身看向女子；背景为带中式暗纹的深棕色墙面，右侧有红色花卉装饰；暖调柔和光影，面部阴影过渡自然，服装刺绣纹理清晰，金属饰品有细腻光泽，发丝蓬松质感真实，景深适中，视觉焦点在情侣互动的温婉氛围，整体色彩以红、金、黑为主，浓郁雅致的中式复古氛围，高清细节，商业摄影质感',
    thumbFile: '/templates/wedding/longfeng-05-tender-fan.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-06',
    name: '竹编灯笼',
    categoryIds: ['wedding', 'outdoor'],
    prompt:
      '竖版构图，远景拍摄，30mm定焦镜头，对焦于男女主体，景深适中，背景适度虚化；主体为一对身着中式婚庆服饰的男女：男子着黑色长款立领长衫，胸戴红花，手持绘有红双喜的竹编灯笼，身体侧转望向身旁女子；女子着金红刺绣中式嫁衣，胸戴红花，双手扶着绘有“花开富贵”的竹编灯笼，侧身望向男子，面带柔和笑意；环境为灰砖墙建筑檐下，背景悬挂多个带吉祥文字的竹编灯笼，地面摆放绘有“平安”字样的竹编灯笼；午后侧方柔光打亮主体，形成建筑阴影与人物轮廓光，整体暖金色调，饱和度适中，复古胶片质感，商业写真风格，细节丰富，竹编纹理清晰，布料褶皱自然，皮肤质感真实，空气带轻微颗粒感，氛围温馨浪漫，充满中式婚庆传统韵味',
    thumbFile: '/templates/wedding/longfeng-06-bamboo-lantern.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-07',
    name: '格栅暖棕',
    categoryIds: ['wedding', 'interior'],
    prompt:
      '竖版商业摄影中景，50mm定焦镜头，浅景深对焦于情侣上半身，背景虚化为暖棕色中式方格格栅；女性身着鎏金提花龙凤褂，布料带有细腻织锦纹理，盘发佩戴全套黄金头饰、项饰与耳饰，坐姿手持金色装饰花束，身体微侧看向镜头，表情温婉柔和；男性身着黑色修身西装，内搭白色立领衬衫，胸口别金色胸针，站姿手轻放女性右肩，看向镜头，表情温和浅笑；左侧深木桌上置粉红色花瓶，插红色花卉与绿色枝叶，旁侧红色剪纸装饰；背景暖橙色方格格栅；主光源为侧前方柔光，人物面部与服饰有自然光泽反射，轮廓光勾勒人物边缘，暖色调氛围，色彩饱和度适中，高级商业写真质感，真实摄影细节丰富，布料纹理、金属光泽清晰，肌肤质感自然。',
    thumbFile: '/templates/wedding/longfeng-07-warm-lattice.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-08',
    name: '秀禾长凳',
    categoryIds: ['wedding', 'studio'],
    prompt:
      '竖版商业人像写真，画面左侧站立男士身着带精致金色刺绣的黑色立领中式礼服，右侧坐姿女士身着满幅金线刺绣的中式秀禾服，侧身朝向画面右侧，手持金色扇状配饰，坐在深色木质长凳上，背景为纯深红色平面；采用中景构图，主体清晰对焦，浅景深虚化背景，正面柔光配合轮廓光勾勒人物边缘，高饱和度经典红金色彩体系，人物姿态正式协调，服装刺绣纹理丰富，面料呈现丝绒与金线光泽，整体为中式复古高级人像摄影风格，画面真实细腻，具备电影级质感。',
    thumbFile: '/templates/wedding/longfeng-08-xiuhe-bench.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-09',
    name: '酒红影棚',
    categoryIds: ['wedding', 'studio'],
    prompt:
      '竖版构图，中景商业摄影，影棚纯酒红色背景，主体为身着黑色中式立领刺绣礼服的男性，站姿端正左手交握于身前；侧身坐于深棕色木椅上的女性，身着金色龙凤褂，右手扶椅沿，左手持带流苏团扇；前侧柔光加轮廓光，光影层次丰富，服装为带亮片刺绣的绸缎材质，配饰是中式传统耳饰、发饰，发丝整齐，皮肤质感细腻，画面饱和度适中，复古高级，真实摄影细节，浅景深对焦人物上半身，商业写真大片质感',
    thumbFile: '/templates/wedding/longfeng-09-wine-red-studio.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-10',
    name: '深红近景',
    categoryIds: ['wedding', 'studio'],
    prompt:
      '竖版近景商业时尚写真，正面柔光均匀打亮人物，纯色深红背景，主体为一对中式婚礼着装的男女：女子身着红底金色绣秀禾服，绣有凤凰纹样与亮片珠饰，梳发髻配金色发饰，戴耳饰手链，手持花卉装饰的小团扇，侧身面向镜头，姿态温婉；男子身着黑色中式礼服，肩部饰有精致金色龙纹刺绣，面向镜头，站姿挺拔。画面超清细节，绣服材质纹理清晰，珠饰光泽自然，发丝整齐，皮肤质感真实，构图对称聚焦主体，无额外环境元素，整体风格典雅正式，符合商业婚纱写真质感。',
    thumbFile: '/templates/wedding/longfeng-10-crimson-closeup.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
] as const satisfies readonly PortraitTemplate[];

const TEMPLATE_BY_ID = new Map<string, PortraitTemplate>(
  PORTRAIT_TEMPLATES.map((template) => [template.id, template]),
);

/** 模板 id → 模板对象；查不到返回 `undefined`（提交会在准入前被参数校验拦下）。 */
export function portraitTemplate(id: unknown): PortraitTemplate | undefined {
  return TEMPLATE_BY_ID.get(String(id ?? '').trim());
}

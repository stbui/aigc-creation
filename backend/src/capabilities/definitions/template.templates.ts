/**
 * 写真模板数据（2026-11-10）。
 *
 * 模板是能力定义的一部分：`prompt` 是提交给模型的风格描述主体，
 * `thumbFile` 是列表卡片的预览图。缩略图存放在本仓库
 * `frontend/public/templates/wedding/`，运行时不请求任何外部站点。
 *
 * 当前 30 套，分三批提取自微信公众号文章（每条模板自身的 `sourceUrl` 保留原文链接）：
 *   · `longfeng-*`（10）：龙凤褂中式写真；
 *   · `flower-*`（10）：花海婚纱；
 *   · `campus-*`（10）：校园操场情侣。
 *
 * 来源记录见 `docs/template-design.md` §5。
 *
 * 2026-11-11 扩充：`portrait-templates.import.ts` 另有 516 套按分类整理的模板。
 * 初始 30 套保持原样（种子脚本与既有测试依赖它），扩充模板只并入下方
 * `TEMPLATE_BY_ID` 查找表 —— 生成与参数校验都能按 id 查回提示词，
 * C 端目录本身仍由数据库下发。
 */
import { IMPORTED_PORTRAIT_TEMPLATES } from './portrait-templates.import';

/** 最近一批模板的来源（接口回显用；每条模板自身仍带 `sourceUrl`）。 */
export const TEMPLATE_SOURCE_URL = 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g';
export const TEMPLATE_CAPTURED_AT = '2026-11-10T00:00:00.000Z';
export const TEMPLATE_ASSET_DIR = '/templates/wedding';

export const TEMPLATE_CATEGORIES = [
  { id: 'wedding', label: '婚纱摄影' },
  { id: 'campus', label: '情侣写真' },
  { id: 'female-portrait', label: '女生写真' },
  { id: 'male-portrait', label: '男生写真' },
  { id: 'professional', label: '职业形象' },
  { id: 'family', label: '亲子写真' },
  { id: 'baby', label: '宝宝写真' },
  { id: 'elite', label: '精英人生' },
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
    categoryIds: ['wedding'],
    prompt:
      '竖版中近景人像写真，85mm定焦镜头，f/2.8大光圈浅景深，主体为身着金色织锦中式嫁衣的女性，嫁衣饰有立体凤凰刺绣，金色盘发搭配流苏金饰，手持刺绣团扇，团扇坠浅色流苏，坐姿优雅，视线正对镜头；背景为纯红色哑光墙面，左侧中式木桌上铺红色缎面餐布，餐布绣双喜纹样，摆黑色花器插红色仿真花簇；商业时尚写真风格，前侧方柔光主光源，勾勒衣物织纹与发饰金属光泽，阴影过渡自然，色彩以浓郁正红与暖金为主，饱和度高对比度强，发丝纹理、嫁衣织缎肌理、刺绣针脚清晰可见，构图稳定对称，视觉焦点集中于人物与团扇',
    thumbFile: '/templates/wedding/longfeng-01-red-wall-fan.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-02',
    name: '双喜砖墙',
    categoryIds: ['wedding'],
    prompt:
      '竖版中景商业写真，中焦镜头，f/4浅景深，对焦于贴红色双喜的男子与持团扇的女子，侧逆光暖金色电影级光影，墙壁为带斑驳痕迹的老旧米色砖墙，背景是带几何花纹的中式八角木窗；男性着黑色暗纹中式长衫，动作是粘贴红色剪纸双喜，女性穿金红织锦龙凤褂，手持红色刺绣团扇，视线望向男性，氛围温婉；画面主色调为暖金红系，复古胶片质感，细节含布料纹理、砖墙壁化痕迹、光影层次与真实皮肤质感，无夸张失真，具传统中式婚照的高级氛围感',
    thumbFile: '/templates/wedding/longfeng-02-double-happiness-wall.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-03',
    name: '东方情侣',
    categoryIds: ['wedding'],
    prompt:
      '竖版商业写真摄影，中近景构图，暖调东方美学风格，画面主体为一对姿态自然的情侣，女性身着绣有金色凤凰纹样的红色中式裙褂，裙褂面料带有精致提花纹理，搭配金色流苏发饰与耳饰，姿态为一手叉腰、另一手轻抬至男性下巴处；男性身着黑色立领盘扣中式西装，姿态为双手背在身后；背景为红金色系花叶装饰与带有竹子纹理的复古墙面，左侧摆放着插有绿植的绿色花瓶，采用柔和侧光与轮廓光照明，光影过渡自然，细节超清，服装刺绣、面料纹理、发丝发丝质感、绿植叶片细节清晰，背景适度虚化突出主体，整体为高级杂志大片质感，色彩饱和统一，暖调氛围浓郁。',
    thumbFile: '/templates/wedding/longfeng-03-oriental-couple.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-04',
    name: '屏风双喜',
    categoryIds: ['wedding'],
    prompt:
      '竖版构图，中景，商业时尚写真，主体为一对年轻男女，并排站立，各自手持红色纸质双喜，对焦于人物与道具，背景是深棕色木质屏风，带有圆形镂空区域，内部印有竹纹图案，右上角点缀红色装饰花；女士身着绣满金色龙凤纹样的中式嫁衣，布料带有精致光泽，头戴金色中式发饰，发丝整齐；男士身着黑色中式立领西装，搭配金属盘扣，服装材质挺括；画面采用柔光主光源，辅以柔和轮廓光，阴影过渡自然，色彩以金、红、黑为主，饱和度适中，色调高级，具备商业级超清细节，可见刺绣纹理、布料质感、真实皮肤细节，背景适当虚化，景深控制合理，整体呈现新中式高级国潮写真风格，真实摄影质感，细节丰富无失真',
    thumbFile: '/templates/wedding/longfeng-04-screen-double-happiness.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-05',
    name: '温婉团扇',
    categoryIds: ['wedding'],
    prompt:
      '竖版近景构图，商业写真风格，主体为一对身着中式礼服的情侣，女子着红金刺绣中式嫁衣，绣有龙凤纹样，搭配精致金色发饰，单手持装饰花团扇，发型盘起，姿态温婉低头；男子着黑色中式立领唐装，侧身看向女子；背景为带中式暗纹的深棕色墙面，右侧有红色花卉装饰；暖调柔和光影，面部阴影过渡自然，服装刺绣纹理清晰，金属饰品有细腻光泽，发丝蓬松质感真实，景深适中，视觉焦点在情侣互动的温婉氛围，整体色彩以红、金、黑为主，浓郁雅致的中式复古氛围，高清细节，商业摄影质感',
    thumbFile: '/templates/wedding/longfeng-05-tender-fan.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-06',
    name: '竹编灯笼',
    categoryIds: ['wedding'],
    prompt:
      '竖版构图，远景拍摄，30mm定焦镜头，对焦于男女主体，景深适中，背景适度虚化；主体为一对身着中式婚庆服饰的男女：男子着黑色长款立领长衫，胸戴红花，手持绘有红双喜的竹编灯笼，身体侧转望向身旁女子；女子着金红刺绣中式嫁衣，胸戴红花，双手扶着绘有“花开富贵”的竹编灯笼，侧身望向男子，面带柔和笑意；环境为灰砖墙建筑檐下，背景悬挂多个带吉祥文字的竹编灯笼，地面摆放绘有“平安”字样的竹编灯笼；午后侧方柔光打亮主体，形成建筑阴影与人物轮廓光，整体暖金色调，饱和度适中，复古胶片质感，商业写真风格，细节丰富，竹编纹理清晰，布料褶皱自然，皮肤质感真实，空气带轻微颗粒感，氛围温馨浪漫，充满中式婚庆传统韵味',
    thumbFile: '/templates/wedding/longfeng-06-bamboo-lantern.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-07',
    name: '格栅暖棕',
    categoryIds: ['wedding'],
    prompt:
      '竖版商业摄影中景，50mm定焦镜头，浅景深对焦于情侣上半身，背景虚化为暖棕色中式方格格栅；女性身着鎏金提花龙凤褂，布料带有细腻织锦纹理，盘发佩戴全套黄金头饰、项饰与耳饰，坐姿手持金色装饰花束，身体微侧看向镜头，表情温婉柔和；男性身着黑色修身西装，内搭白色立领衬衫，胸口别金色胸针，站姿手轻放女性右肩，看向镜头，表情温和浅笑；左侧深木桌上置粉红色花瓶，插红色花卉与绿色枝叶，旁侧红色剪纸装饰；背景暖橙色方格格栅；主光源为侧前方柔光，人物面部与服饰有自然光泽反射，轮廓光勾勒人物边缘，暖色调氛围，色彩饱和度适中，高级商业写真质感，真实摄影细节丰富，布料纹理、金属光泽清晰，肌肤质感自然。',
    thumbFile: '/templates/wedding/longfeng-07-warm-lattice.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-08',
    name: '秀禾长凳',
    categoryIds: ['wedding'],
    prompt:
      '竖版商业人像写真，画面左侧站立男士身着带精致金色刺绣的黑色立领中式礼服，右侧坐姿女士身着满幅金线刺绣的中式秀禾服，侧身朝向画面右侧，手持金色扇状配饰，坐在深色木质长凳上，背景为纯深红色平面；采用中景构图，主体清晰对焦，浅景深虚化背景，正面柔光配合轮廓光勾勒人物边缘，高饱和度经典红金色彩体系，人物姿态正式协调，服装刺绣纹理丰富，面料呈现丝绒与金线光泽，整体为中式复古高级人像摄影风格，画面真实细腻，具备电影级质感。',
    thumbFile: '/templates/wedding/longfeng-08-xiuhe-bench.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-09',
    name: '酒红影棚',
    categoryIds: ['wedding'],
    prompt:
      '竖版构图，中景商业摄影，影棚纯酒红色背景，主体为身着黑色中式立领刺绣礼服的男性，站姿端正左手交握于身前；侧身坐于深棕色木椅上的女性，身着金色龙凤褂，右手扶椅沿，左手持带流苏团扇；前侧柔光加轮廓光，光影层次丰富，服装为带亮片刺绣的绸缎材质，配饰是中式传统耳饰、发饰，发丝整齐，皮肤质感细腻，画面饱和度适中，复古高级，真实摄影细节，浅景深对焦人物上半身，商业写真大片质感',
    thumbFile: '/templates/wedding/longfeng-09-wine-red-studio.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'longfeng-10',
    name: '深红近景',
    categoryIds: ['wedding'],
    prompt:
      '竖版近景商业时尚写真，正面柔光均匀打亮人物，纯色深红背景，主体为一对中式婚礼着装的男女：女子身着红底金色绣秀禾服，绣有凤凰纹样与亮片珠饰，梳发髻配金色发饰，戴耳饰手链，手持花卉装饰的小团扇，侧身面向镜头，姿态温婉；男子身着黑色中式礼服，肩部饰有精致金色龙纹刺绣，面向镜头，站姿挺拔。画面超清细节，绣服材质纹理清晰，珠饰光泽自然，发丝整齐，皮肤质感真实，构图对称聚焦主体，无额外环境元素，整体风格典雅正式，符合商业婚纱写真质感。',
    thumbFile: '/templates/wedding/longfeng-10-crimson-closeup.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
  },
  {
    id: 'flower-01',
    name: '草坪花海',
    categoryIds: ['wedding'],
    prompt:
      '竖版商业婚纱写真，50mm定焦镜头，中景构图，f2.8光圈，浅景深虚化背景，主体为户外草坪上的一对新人：男士身着浅米色西装套装，配粉色领结与胸花，坐于地面仰头抬手；女士身着粉色立体花朵装饰的蓬蓬纱婚纱，发间点缀小花，手臂张开面露喜悦，腿上放一本打开的书；背景是布置了木质秋千架、鲜花藤蔓与蓝丝带装饰的户外场景，空中漂浮粉色花瓣；前景布满野花与绿植，中景为人物与装饰，背景为朦胧绿植；光影为柔和侧逆光，勾勒人物轮廓光，环境光为明亮绿色，整体暖调清新，色彩为马卡龙色系，饱和度适中，电影级调色，轻微摄影颗粒感，视觉焦点在人物互动上，细节丰富，纱质纹理、西装面料光泽、鲜花真实质感、花瓣漂浮感清晰呈现，商业写真风格，梦幻浪漫氛围',
    thumbFile: '/templates/wedding/flower-01-lawn-flower-sea.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw',
  },
  {
    id: 'flower-02',
    name: '花门拱窗',
    categoryIds: ['wedding'],
    prompt:
      '竖版商业婚纱写真，中景构图，主体为姿态活泼的新人：男士穿浅棕色西装套装，手持粉紫色花束高举，双腿舒展坐于地面；女士着多层褶皱粉色薄纱婚纱，披浅粉色头纱，侧头抬手呈灵动姿态。场景为木质拱形玻璃门的室内空间，门框及两侧环绕粉白浅紫等鲜花与绿植，前景散落白色百合、蕨类植物，门外是葱郁户外花园。采用50mm中焦段，光圈f/2.8，浅景深，对焦新人面部，户外拱门透入逆光照亮人物轮廓，柔光覆盖室内，阴影过渡柔和。色彩以粉绿为主，饱和度适中，带暖调电影氛围，画面质感细腻，具时尚写真高级感。',
    thumbFile: '/templates/wedding/flower-02-flower-arch-window.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw',
  },
  {
    id: 'flower-03',
    name: '花枝拥吻',
    categoryIds: ['wedding'],
    prompt:
      '竖版中景，中焦段f/2.8大光圈拍摄，商业写真风格，画面主体为一对年轻男女坐在装饰着粉、白、橙黄色系花艺的麻绳秋千上；秋千两侧鲜花要很多很多；男士身着白色西装套装搭配领结，侧身低头，右手轻触女士发间，姿态温柔；女士身着粉色抹胸立体花装饰蓬纱婚纱，手持粉色花束，正视镜头，情绪甜美柔和；背景为繁茂的户外竹林绿植，浅景深虚化背景突出主体；采用柔和侧逆光，营造自然光影层次，清晰呈现婚纱纱质纹理、西装面料光泽、花艺微观细节，发丝轻盈自然，整体以柔粉色、白色、绿色为主色调，饱和度适中，氛围清新浪漫，为蜜月摄影的高级写真模板，画面细节丰富，包含布料褶皱、光影过渡的真实质感',
    thumbFile: '/templates/wedding/flower-03-flower-column-kiss.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw',
  },
  {
    id: 'flower-04',
    name: '棕榈草坪',
    categoryIds: ['wedding'],
    prompt:
      '竖版商业写真摄影，中景构图，对焦于画面中部的一对人物：左侧男性身着浅米白色西装套装，右侧女性身着香槟色层叠薄纱拖尾礼服裙，两人立于开阔翠绿的热带草坪之上；场景周围布置浅粉、蓝色、香槟色花艺装饰，前景有虚化花艺丰富层次，背景是高大棕榈树林与延伸小径；采用侧逆光搭配柔和补光，暖调清新氛围，色彩饱和度适中、过渡自然，画面细节丰富，西装面料纹理、纱裙层叠褶皱、花艺花瓣层次清晰，发丝自然舒展，皮肤质感细腻真实，商业摄影级真实质感',
    thumbFile: '/templates/wedding/flower-04-palm-lawn.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw',
  },
  {
    id: 'flower-05',
    name: '日落花海',
    categoryIds: ['wedding'],
    prompt:
      '85mm f/1.4镜头拍摄，横版构图，浅景深，平视角度，对焦在中景人物。户外日落时分草坪场景，暖粉色天空，逆光营造轮廓光与体积光，空气带柔和光晕，前景大朵粉白花艺虚化，中景是一对新人：男士穿米白色正装套装、白色皮鞋，女士穿白色短款纱质婚纱，头戴白色花艺花环，飘动感长头纱，手持浅粉色玫瑰捧花，渔网袜搭配带装饰的白色鞋子，女士闭眼氛围柔和，男士侧身向侧方。场景两侧是粉、白、浅紫花材与绿叶组成的大型花艺拱门，背景为绿树与开阔草地。商业摄影质感，暖调统一，纱质纹理、花艺层次、发丝飘动细节丰富，光影过渡柔和，真实摄影质感，无失真问题',
    thumbFile: '/templates/wedding/flower-05-sunset-flower-sea.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw',
  },
  {
    id: 'flower-06',
    name: '绿植花房',
    categoryIds: ['wedding'],
    prompt:
      '横版构图，中景到近景景别，对焦在依偎的情侣身上，背景适度虚化，商业时尚写真风格。室内被繁茂绿植与各色鲜花环绕的空间，柔和侧逆光从左侧打入，形成温柔体积光与光斑，暖调氛围，胶片质感。男士身着浅米色西装套装，面料有细腻纹理，佩戴胸花；女士穿着白色纱质婚纱，裙摆轻盈，发丝自然散落，二人头靠头面带笑意，肢体亲昵互动。前景有虚化的浅色花卉，中景为主体情侣，背景是浓密的绿色植物、紫色黄色白色各色花卉，空间层次丰富，阴影过渡自然，色彩饱和度适中，暖绿与暖白为主色调，点缀艳红色花艺，整体温馨浪漫，真实摄影质感，无AI失真问题。',
    thumbFile: '/templates/wedding/flower-06-green-flower-room.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw',
  },
  {
    id: 'flower-07',
    name: '蓝纱花柱',
    categoryIds: ['wedding'],
    prompt:
      '竖版远景构图，商业婚礼人像写真，标准焦段拍摄，景深对焦于相拥的新人，背景及周围花艺，画面主体为姿态温柔的男子站在女子后背搂着女子腰部，男子着白色西装配领结，戴眼镜；女子穿深蓝色立体花朵抹胸蓬纱婚纱，头戴花艺发饰，颈系蕾丝颈饰，发丝细节清晰，皮肤质感细腻。场景为室内森系花艺布置，四周环绕繁茂的蕨类、粉白浅紫花簇，左侧有带蕾丝罩面的小圆桌，桌上放旧书籍；背景是大面积落地玻璃窗，透进柔和自然光，侧方主光源为柔光，后方有轮廓光勾勒人物边缘，阴影层次过渡自然，整体色彩以浅蓝、柔粉、嫩绿为主，饱和度适中，高级色彩统一，画面细节丰富，包含婚纱纱质纹理、西装面料光泽、花艺微观细节，真实摄影噪点，温馨浪漫的电影级氛围，呈现人物互动的温柔姿态与情绪氛围',
    thumbFile: '/templates/wedding/flower-07-blue-dress-flower-column.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw',
  },
  {
    id: 'flower-08',
    name: '绿墙蝴蝶结',
    categoryIds: ['wedding'],
    prompt:
      '竖版构图，中景拍摄，商业写真风格，一对年轻男女（仅描述肢体动作），男士身着浅卡其色西装套装，双臂交叉姿态放松；女士身着白色吊带纱质婚纱，怀中抱透明玻璃罐，头部轻靠男士肩部，二人互动亲昵；背景为浓密绿植墙，墙面上装饰大型白色缎面蝴蝶结，点缀黄色、紫色、白色各类花卉；前景分布草本植物与小型花卉；采用柔和自然光，主光源来自上方，人物衣物与皮肤有自然阴影过渡，背景略带虚化，景深层次分明；画面色彩清新柔和，饱和度适中，电影级质感，超清细节，材质纹理真实（西装毛料、婚纱纱质、绿植肌理、缎面光泽），皮肤质感自然，整体氛围温馨浪漫，商业摄影高级感',
    thumbFile: '/templates/wedding/flower-08-green-wall-bow.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw',
  },
  {
    id: 'flower-09',
    name: '木屋花境',
    categoryIds: ['wedding'],
    prompt:
      '竖版商业婚纱写真，中景构图，景深较浅，对焦于女性面部，画面主体为穿粉色渐变蓬蓬纱礼服的女性，手持粉色花束，手托脸颊姿态柔美，身旁交叉手臂侧身看向镜头的男性身着白色礼服；背景为装饰着大粉色蝴蝶结与多彩花饰的木质小屋，左侧立有带天使雕刻的白色喷泉，远处可见雪山，采用柔光拍摄，冷暖色彩搭配自然，呈现清新浪漫风格，高清细节，纱质纹理清晰，花饰层次丰富，木质建筑质感真实，光影柔和过渡，商业摄影质感十足',
    thumbFile: '/templates/wedding/flower-09-wooden-house-flower.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw',
  },
  {
    id: 'flower-10',
    name: '蔷薇花园',
    categoryIds: ['wedding'],
    prompt:
      '竖版构图，中近景拍摄，50mm f/2.8镜头，浅景深虚化背景，对焦于主体人物；室外蔷薇花园场景，前景是垂落的绿色槐树枝与淡粉蔷薇花，中景主体为年轻男女，女子穿粉紫色立体花朵装饰的蓬纱婚纱，蕾丝面料搭配多层褶皱裙摆，边缘带小亮片，发间点缀花朵，右手轻触花枝，左手摊开；男子穿白色礼服西装，领口配同色系蝴蝶结，左手捧淡粉玫瑰花束；柔和户外自然光，侧逆光勾勒人物轮廓，前方柔光作为主光源，阴影层次过渡自然，空气带细微颗粒感；主色调淡粉紫色，饱和度适中，色彩统一，氛围清新浪漫，商业时尚写真质感；背景为虚化的绿色花丛与淡蓝色天空，布料纹理清晰，花瓣质感真实，发丝轻盈，人物视线朝向镜头，互动自然，细节丰富无失真，符合真实摄影逻辑',
    thumbFile: '/templates/wedding/flower-10-rose-garden.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw',
  },
  {
    id: 'campus-01',
    name: '草坪并坐',
    categoryIds: ['campus'],
    prompt:
      '竖版构图，中景，商业时尚写真风格，日系清新色调，户外大学校园操场场景，主体为两名年轻人物坐在翠绿草坪上，左侧男性着米白色卡通印花短袖T恤、深棕色休闲长裤、黄色低帮运动鞋，侧身朝向右侧人物；右侧女性着同款米白色短袖T恤、灰色百褶短裙、白色运动鞋，双麻花辫，双手举红色罐装饮品置于头顶，视线看向镜头。前景是纹理清晰的翠绿草坪，中景人物姿态自然，背景是成排的垂柳、浅蓝灰调的教学楼建筑，上方是飘着蓬松白云的明亮蓝天。光影为柔和的自然光，侧前方主光源，人物边缘带轻微轮廓光，阴影过渡自然，空气通透感强，画质超清，细节丰富，布料褶皱纹理、发丝细节、草坪草茎细节均清晰呈现，景深效果自然，视觉焦点集中在两名人物的互动姿态上，整体色调清新明快，饱和度适中，带有胶片感的柔和氛围。',
    thumbFile: '/templates/wedding/campus-01-lawn-sitting.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g',
  },
  {
    id: 'campus-02',
    name: '气球合影',
    categoryIds: ['campus'],
    prompt:
      '竖版构图，近景景别，采用50mm定焦镜头拍摄，浅景深虚化背景，对焦于情侣主体；主体为一对年轻男女：女生侧头带微笑，左臂向画面左侧舒展，扎双麻花辫配浅蓝色蝴蝶结，身着浅米色带卡通印花字母T恤、灰色百褶褶裙，手腕有细小花饰；男生戴透明框眼镜，右手揽女生腰，左手持粉、浅蓝、浅绿三个马卡龙色系哑光气球，着同款式浅米色T恤、灰色休闲短裤；环境为户外校园操场，前景是草坪，中远景有绿色树木、浅色系楼宇，上方是布满蓬松白云的明亮蓝天；光影是白天柔和自然光，主光源来自画面上方，物体阴影过渡自然，空气带轻微通透感；色彩为日系清新马卡龙色调，饱和度适中，对比度柔和，画面质感为商业写真级，细节丰富，包含布料褶皱纹理、发丝细微状态、气球哑光反光、皮肤真实质感，整体氛围青春活泼。',
    thumbFile: '/templates/wedding/campus-02-balloon-photo.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g',
  },
  {
    id: 'campus-03',
    name: '泡泡相机',
    categoryIds: ['campus'],
    prompt:
      '日系清新商业写真，竖版构图，近景，50mm定焦镜头，f/2.8大光圈，浅景深，对焦于年轻情侣面部，柔和侧逆光打造发丝轮廓光，环境光为晴朗户外的冷调天光，整体色调清新明快，饱和度适中，蓝天、绿树、灰白色弧形校园建筑为背景，前景是翠绿草坪；女生扎双麻花辫，穿浅米色带卡通印花的T恤、灰色百褶裙、白色运动鞋，右手高举指向上方，左手持粉色小猪泡泡相机；男生身着同系列浅米色T恤、灰色长裤、黄色板鞋，坐在女生身后；画面含飘浮的透明泡泡，发丝、衣物褶皱纹理清晰，皮肤质感真实，光影过渡自然，空气感柔和，符合真实摄影逻辑，无多余元素。',
    thumbFile: '/templates/wedding/campus-03-bubble-camera.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g',
  },
  {
    id: 'campus-04',
    name: '城堡草坪',
    categoryIds: ['campus'],
    prompt:
      '竖版近景，日系清新校园情侣写真，主体为坐在操场草坪上的年轻男女，两人侧身对视互动，女生手持粉色迷你相机，穿着印字母的米白色宽松短袖T恤、灰色百褶短裙、白色中筒袜与白色运动鞋，男生穿着同款式米白色短袖T恤、棕色休闲长裤、黄色运动鞋，男子手臂轻搭在女生头顶；背景是成排的蓝底树干的绿树，远处是白墙灰顶的特色校园建筑，晴朗蓝天飘着淡云；画面光线为柔和的自然日光，侧光打造自然阴影层次，空气里有浮动的透明泡泡颗粒感，背景虚化形成浅景深，焦点清晰落在两人互动姿态与服饰细节，色彩清新明快，饱和度适中，充满青春浪漫的商业写真质感，发丝、衣物褶皱、皮肤质感细节真实自然，构图饱满温馨。',
    thumbFile: '/templates/wedding/campus-04-castle-lawn.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g',
  },
  {
    id: 'campus-05',
    name: '看台并坐',
    categoryIds: ['campus'],
    prompt:
      '横版构图，中焦镜头，平视拍摄，近景景别，主体为一男一女盘腿坐在体育场绿色人造草坪上，男性身着带小标识的浅白色短袖T恤、黑色运动长裤、白色运动鞋，女性身着带小标识的纯白色短袖T恤、藏青色运动长裤、黑色运动鞋，女性双手交叠置于腿前；背景是色彩分区的阶梯式观众看台，红黄蓝三色座椅规整排列，看台上方悬挂红色横幅，右侧设有足球门，远处可见建筑与绿植；采用白天柔和自然光，侧光塑造自然阴影，画面色彩清新饱和，真实还原布料纹理、发丝细节、草坪肌理与看台结构，景深效果清晰突出主体，背景适度虚化，整体为商业写真级写实摄影，氛围轻松自然，空气质感通透，带有原生摄影噪点，风格清新治愈，人物真实无AI痕迹。',
    thumbFile: '/templates/wedding/campus-05-stands-sitting.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g',
  },
  {
    id: 'campus-06',
    name: '黄色看台',
    categoryIds: ['campus'],
    prompt:
      '横版近景拍摄，采用50mm定焦镜头，浅景深效果，焦点落在互动的两位人物身上，背景为虚化的体育场亮黄色塑料看台座椅，空间层次分明。画面主体为两位年轻人物，女性侧身前倾，双手自然搭在膝盖上，头部侧转看向男性，肢体语言柔和放松；男性侧身面向女性，视线交汇互动。服装为纯棉质感的白色短袖T恤，带有低调刺绣标识，布料褶皱自然，发丝在自然光下带有细微光泽，皮肤质感真实。环境为户外露天体育场看台，晴朗白天的自然光，主光源来自侧上方，轮廓光勾勒人物边缘，阴影过渡柔和，整体为时尚情侣写真风格，暖色调，色彩饱和度适中，空气通透有自然颗粒感，构图引导视线聚焦于两人的甜蜜互动关系。',
    thumbFile: '/templates/wedding/campus-06-yellow-stands.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g',
  },
  {
    id: 'campus-07',
    name: '看台牵手',
    categoryIds: ['campus'],
    prompt:
      '横版构图，50mm定焦镜头，f/2.8光圈，浅景深，近景写实商业写真，两位年轻人坐在体育场黄色塑料看台座椅上，男性着带黑色小标白色短袖T恤与黑色运动裤，女性着白色短袖T恤与深色长裤，女性伸手靠近男性握拳的左手，两人面带笑容互动，白天侧方自然光，阳光在衣物、皮肤、座椅上形成自然光影，背景是排列整齐的黄色塑料座椅，背景虚化突出主体，真实呈现发丝、衣物褶皱、皮肤质感，整体色调明亮温暖，饱和度适中，层次分明，细节丰富，具电影级光影与商业高级质感。',
    thumbFile: '/templates/wedding/campus-07-stands-holding-hands.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g',
  },
  {
    id: 'campus-08',
    name: '草坪头纱',
    categoryIds: ['campus'],
    prompt:
      '竖版中景商业时尚写真，50mm标准镜头，f/1.8大光圈，浅景深虚化背景，对焦于女性面部，拍摄角度平视略低；主体年轻情侣，女性坐于草坪，手托脸颊，持白橙粉蓝搭配的小花花束，头戴轻盈白色短网纱头纱，双麻花辫发型，穿白色吊带裙与带彩色花补丁的牛仔裤；男性身体前倾站于女性侧后方，手比V手势，穿黑色挺括西装外套、白色衬衫、黑色领带，佩戴白色马蹄莲胸花，下身着带彩色花补丁的牛仔裤；背景为鲜活绿色运动草坪，远处是带浅棕色遮阳棚的运动场看台，浅淡柔和的灰蓝色天空；采用柔和侧前方自然光，柔光质感，阴影过渡自然，整体色彩清新暖调，带有复古胶片感，空气通透有细微摄影颗粒，画面细节丰富真实，无透视变形、材质失真，写实风格情侣写真。',
    thumbFile: '/templates/wedding/campus-08-lawn-veil.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g',
  },
  {
    id: 'campus-09',
    name: '操场婚纱',
    categoryIds: ['campus'],
    prompt:
      '横版近景构图，中焦镜头，平视机位，浅景深效果，焦点清晰落在情侣身上；主体为一对青年情侣，男性着黑色西装外套、白色衬衫、黑色领带，牛仔裤裤腿带彩色花朵刺绣补丁，脚穿白色休闲鞋，胸戴白色胸花，盘腿坐于草坪；女性着白色吊带拖尾婚纱裙，牛仔裤裤腿带彩色花朵刺绣补丁，双麻花辫配白色头纱，脚穿白色休闲鞋，手捧浅粉白橙花束，侧身依偎男性，面带微笑；背景是大片绿色人工草坪，有两条对称绿色草坪带；柔和自然光来自前方偏侧，自然阴影，色彩清新明亮，饱和度适中，有商业写真质感，布料纹理清晰，发丝自然，光影过渡柔和，真实摄影噪点自然，青春创意婚纱写真风格。',
    thumbFile: '/templates/wedding/campus-09-field-wedding.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g',
  },
  {
    id: 'campus-10',
    name: '球场摸头',
    categoryIds: ['campus'],
    prompt:
      '50mm定焦镜头拍摄，竖版近景构图，日系清新写真风格，人物为穿校服的年轻男女，男生站立身体微前倾，右手轻放在女生头顶，女生蹲坐抬头看向男生，互动氛围甜蜜；场景为户外足球场，绿色人工草坪，背景是蓝红配色的体育场看台；采用侧方柔和自然光，阴影过渡自然，色彩清新柔和饱和度适中，对焦在人物互动处，背景看台适度虚化，布料纹理、发丝细节、配饰质感清晰，呈现商业摄影质感，画面真实细节丰富无失真。',
    thumbFile: '/templates/wedding/campus-10-field-head-pat.webp',
    sourceUrl: 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g',
  },
] as const satisfies readonly PortraitTemplate[];

/*
 * 初始 30 套 + 扩充 516 套共用一个查找表。
 * 扩充数据的 `categoryIds` 是字符串数组，与这里的字面量联合类型等价但不被
 * TS 自动收窄，故整段做一次类型断言；字段形状在导入文件里逐条对齐。
 */
const TEMPLATE_BY_ID = new Map<string, PortraitTemplate>(
  [...PORTRAIT_TEMPLATES, ...(IMPORTED_PORTRAIT_TEMPLATES as unknown as PortraitTemplate[])].map(
    (template) => [template.id, template],
  ),
);

/** 模板 id → 模板对象；查不到返回 `undefined`（提交会在准入前被参数校验拦下）。 */
export function portraitTemplate(id: unknown): PortraitTemplate | undefined {
  return TEMPLATE_BY_ID.get(String(id ?? '').trim());
}

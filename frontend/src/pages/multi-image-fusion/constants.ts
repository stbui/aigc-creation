import { MAX_IMAGE_MB } from '../../lib/constants';

/**
 * 多图融合页面的常量与类型 —— 目录内文件的唯一常量入口。
 *
 * 场景分组、数量上限与文案都来自 `docs/multi-image-fusion-spec.md` 的
 * 参考站实测原文 (§4.1)。页面、场景网关与结果面板共用同一份定义:
 * 改一处就等于改全站文案与上限。
 *
 * 约定: `multi-image-fusion/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件 (上传限制) 或 `./utils` (校验函数) —— 目录内新增共享常量时
 * 在这里补一行。
 */

/** 单张图片体积上限与支持格式, 全站上传校验共用 */
export {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
} from '../../lib/constants';

/** 场景卡定义 */
export interface SceneDef {
  value: string;
  label: string;
  desc: string;
}

/** §4.1 实测原文: 分组标题仅 h2, 无描述文案 (见 D-13) */
export const SCENE_GROUPS: Array<{ name: string; scenes: SceneDef[] }> = [
  {
    name: '表面附着',
    scenes: [
      { value: 'print_pattern', label: '印花/图案', desc: '手机壳、服装、杯具等表面的图案融合' },
      { value: 'embroidery', label: '刺绣/绣花', desc: '服装、帽子等织物表面的刺绣融合' },
      { value: 'texture', label: '纹理/材质', desc: '木纹、大理石、碳纤维等表面材质融合' },
      { value: 'sticker', label: '贴纸/贴花', desc: '笔记本、滑板、行李箱等表面的贴纸融合' },
      { value: 'hot_stamping', label: '烫金/烫印', desc: '包装、皮具等表面的烫金与压印效果' },
      { value: 'carving', label: '雕刻/蚀刻', desc: '金属、玻璃等表面的雕刻与磨砂图案' },
      { value: 'painting', label: '彩绘/涂装', desc: '头盔、陶瓷等表面的喷绘与手绘融合' },
    ],
  },
  {
    name: '空间摆放',
    scenes: [
      { value: 'table_display', label: '桌面陈列', desc: '办公用品、化妆品等桌面组合陈列' },
      { value: 'wearing', label: '穿搭/佩戴', desc: '模特、手模与服装配饰融合' },
      { value: 'scene_match', label: '场景搭配', desc: '家具进房间、产品进展台、陈设入空间' },
      { value: 'handheld', label: '手持展示', desc: '手模或人物自然手持商品与道具' },
      { value: 'combo_set', label: '组合套装', desc: '礼盒、多件商品与套装组合展示' },
      { value: 'food_plating', label: '食品摆盘', desc: '餐盘、托盘与菜品茶具组合' },
      { value: 'storage_display', label: '收纳展示', desc: '收纳盒、化妆包与内部物件展示' },
      { value: 'shelf_display', label: '货架陈列', desc: '货架、书架与多件商品陈列' },
    ],
  },
];

/** 扁平场景表: 按 value 反查场景定义 */
export const ALL_SCENES = SCENE_GROUPS.flatMap((group) => group.scenes);

/** 变体张数选项 */
export const VARIANT_COUNTS = ['4', '3', '2', '1'];

/** §4.1 计数器「0 / 6」(主体 1 + 搭配 1-5) */
export const MAX_TOTAL = 6;
/** §4.1 字段标签「必传 · 1-5 张」 */
export const MAX_ACCENTS = 5;

/** 结果空态文案 */
export const EMPTY_TITLE = '等待你的第一组融合创意';
export const EMPTY_HINT = '上传图片并提交生成，预览会出现在这里';

/** 主体图上上传区文案 */
export const UPLOAD_SUBJECT_HINT = `支持 JPG、PNG，单张不超过 ${MAX_IMAGE_MB}MB，可直接粘贴`;

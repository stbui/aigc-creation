import { Download, SlidersHorizontal, Upload } from 'lucide-react';

/**
 * 营销首页的常量、类型与静态数据。
 *
 * 约定: `landing/` 下的文件不散落各自的常量, 一律从本文件取;
 * 目录内新增常量时在这里补一行, 便于一眼看全这一页的写死文案与素材清单。
 *
 * 商业内容 (价目 / 案例图 / 客户 logo) 来自 `frontend/public/landing/` 自托管资源,
 * 价目、能力清单、活动一律读后端接口 —— 页面不写死任何价格或能力数量。
 */

/** 资源前缀: 全部落在 public/landing 下, 由 vite 原样拷贝 */
export const A = '/landing';

/** 核心场景入口卡 */
export interface BizCard {
  title: string;
  desc: string;
  img: string;
  icon: string;
  to: string;
  capability: string;
}

/** 三条核心场景主线 */
export const BIZ_CARDS: BizCard[] = [
  {
    title: '商品主图',
    desc: '一键生成白底、场景、卖点等主图套图',
    img: `${A}/biz/商品套图.png`,
    icon: 'm_spzt',
    to: '/product-kit',
    capability: 'main_image',
  },
  {
    title: '商品详情',
    desc: '一键生成卖点、参数、细节等详情长图',
    img: `${A}/biz/商品详情.png`,
    icon: 'm_spxq',
    to: '/product-detail',
    capability: 'detail_image',
  },
  {
    title: '爆款复刻',
    desc: '一键复刻多张同款风格商品图',
    img: `${A}/biz/爆款复刻.png`,
    icon: 'm_bkfk',
    to: '/viral-clone',
    capability: 'hot_remake',
  },
];

/** 修图工具入口 */
export interface ToolEntry {
  label: string;
  icon: string;
  to: string;
  capability: string;
}

/** 套餐与积分区的三个页签 */
export type LandingPackageTab = 'sub' | 'addon' | 'campaign';

/** 8 个常用修图工具, 一屏内完成选择 */
export const TOOL_ENTRIES: ToolEntry[] = [
  { label: '局部重绘', icon: 'm_jbch', to: '/local-redraw', capability: 'local_redraw' },
  { label: '一键抠图', icon: 'm_bjxc', to: '/background-remove', capability: 'matting' },
  { label: '去除水印', icon: 'm_qcsy', to: '/watermark-remove', capability: 'remove_watermark' },
  { label: '产品精修', icon: 'm_cpjx', to: '/product-retouch', capability: 'enhance' },
  { label: '图片翻译', icon: 'm_tpfy', to: '/image-translate', capability: 'image_translate' },
  { label: '智能扩图', icon: 'm_znkt', to: '/image-expand', capability: 'expand' },
  { label: '商品换色', icon: 'm_sphs', to: '/product-recolor', capability: 'recolor' },
  { label: '旋转角度', icon: 'm_jdxz', to: '/rotate-angle', capability: 'rotate' },
];

/** 顶部菜单与参考站 `/static/menu/*.svg` 对齐的本地图标。 */
export const NAV_ICONS: Record<string, string> = {
  free_create: '/menu/m_cyst.svg',
  image_to_video: '/menu/m_cyst.svg',
  main_image: '/menu/m_spzt.svg',
  detail_image: '/menu/m_spxq.svg',
  hot_remake: '/menu/m_bkfk.svg',
  creative_image: '/menu/m_cyst.svg',
  multi_fusion: '/menu/m_dtrh.svg',
  sku_image: '/menu/m_sku.svg',
  local_redraw: '/menu/m_jbch.svg',
  matting: '/menu/m_bjxc.svg',
  remove_watermark: '/menu/m_qcsy.svg',
  enhance: '/menu/m_cpjx.svg',
  image_translate: '/menu/m_tpfy.svg',
  expand: '/menu/m_znkt.svg',
  recolor: '/menu/m_sphs.svg',
  rotate: '/menu/m_jdxz.svg',
};

/**
 * 加油包卡片图标。图标是**视觉资产**, 与定价无关, 故仍在前端按位置取 ——
 * 价目与积分数一律读 GET /products。
 *
 * ⚠ 2026-10-20 起本页不再硬编码加油包价目。此前写死的一组价
 * (¥19.90/100 积分) 与后台 seed-commerce 的 (¥9.90/500 积分) 单位成本差 10 倍,
 * 两套并存会让用户看到的价格与实付对不上。现在只认后端这一套。
 */
export const ADDON_ICONS = ['icon_jcb', 'icon_bzb', 'icon_zyb', 'icon_qjb'];

/**
 * 首屏拼贴图 —— 取自案例库的真实产出, 不另外做示意图。
 * 访客在第一屏看到的是「能做出什么」, 而不是一段需要读三遍才懂的文案。
 */
export const HERO_SHOTS = [
  { src: `${A}/case/spzt_01_1.png`, label: '白底主图' },
  { src: `${A}/case/spxqt_02_1.png`, label: '详情长图' },
  { src: `${A}/case/cpjx_03_1.png`, label: '产品精修' },
  { src: `${A}/case/cyst_04.png`, label: '创意场景' },
];

/** 使用流程三步: 固定文案, 不随接口变化 —— 这是产品口径, 不是商品数据 */
export const FLOW_STEPS = [
  { icon: Upload, title: '上传商品图', desc: '拖入或选择本地图片，作为整套视觉的起点' },
  { icon: SlidersHorizontal, title: '选择能力与风格', desc: '白底、场景、卖点、详情，按需勾选组合' },
  { icon: Download, title: '下载成品', desc: '生成即入库，可在作品库继续复用与二创' },
];

/**
 * 生成案例文件名列表。
 * 双图制 (16 张): `spzt_01_1.png … spzt_08_2.png`, 末位可能为 .jpg;
 * 单图制 (8 张): `bkfk_01.png … bkfk_08.png` / `cyst_01.png … cyst_08.png` (pair=0)
 */
export function buildFiles(
  prefix: string,
  count: number,
  ext: string,
  lastOverride?: string,
  pair = 1,
): string[] {
  const files: string[] = [];
  const pairs = count / 2;
  for (let i = 1; i <= (pair === 0 ? count : pairs); i += 1) {
    const n = String(i).padStart(2, '0');
    if (pair === 0) {
      files.push(`${prefix}_${n}.${ext}`);
    } else {
      files.push(`${prefix}_${n}_1.${ext}`);
      const isLast = i === pairs;
      const secondExt = isLast && lastOverride ? lastOverride : ext;
      files.push(`${prefix}_${n}_2.${secondExt}`);
    }
  }
  return files;
}

/** 案例分组 */
export interface CaseGroup {
  /** 分组键 (同时用于查能力映射) */
  key: string;
  /** 对应能力 id */
  capability: string;
  /** 分组标题 */
  label: string;
  /** 该分类下的案例文件名 */
  files: string[];
}

/**
 * 案例分组: key → 能力 + 文件名列表。
 * 首页按顺序平铺全部 7 个分类, 不再用页签切换 —— 访客一屏滚动就能看全能力覆盖。
 */
export const CASE_GROUPS: CaseGroup[] = [
  { key: 'spzt', capability: 'main_image', label: '商品主图', files: buildFiles('spzt', 16, 'png', 'jpg') },
  { key: 'spxqt', capability: 'detail_image', label: '商品详情图', files: buildFiles('spxqt', 16, 'png') },
  { key: 'bkfk', capability: 'hot_remake', label: '爆款复刻', files: buildFiles('bkfk', 8, 'png', undefined, 0) },
  { key: 'cyst', capability: 'free_create', label: '创意生图', files: buildFiles('cyst', 8, 'png', undefined, 0) },
  { key: 'cpjx', capability: 'enhance', label: '产品精修', files: buildFiles('cpjx', 16, 'png') },
  { key: 'yjkt', capability: 'matting', label: '一键抠图', files: buildFiles('yjkt', 16, 'png') },
  { key: 'xzjd', capability: 'rotate', label: '旋转角度', files: buildFiles('xzjd', 16, 'png') },
];

/** 案例分组 → 能力 id: 「做同款」按钮要跳到对应工具页 */
export const CASE_CAPABILITY_MAP: Record<string, string> = {
  spzt: 'main_image',
  spxqt: 'detail_image',
  bkfk: 'hot_remake',
  cyst: 'free_create',
  cpjx: 'enhance',
  yjkt: 'matting',
  xzjd: 'rotate',
};

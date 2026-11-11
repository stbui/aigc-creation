import type { StatsOverview } from '../../types/api';

/**
 * 工作台页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 卡片示例图映射与数据看板指标表集中在这里: 工具网格与看板各自只渲染，
 * 新增能力或指标只改本文件，不在组件里散落映射。
 */

/** 参考站工作台固定示例图与菜单图标；与能力 id 一一对应。 */
export const WORKBENCH_ART: Record<string, { image: string; icon: string }> = {
  main_image: { image: '/workbench/spzt.webp', icon: '/workbench/icons/m_spzt.svg' },
  detail_image: { image: '/workbench/spxq.webp', icon: '/workbench/icons/m_spxq.svg' },
  hot_remake: { image: '/workbench/bkfk.webp', icon: '/workbench/icons/m_bkfk.svg' },
  creative_image: { image: '/workbench/cyst.webp', icon: '/workbench/icons/m_cyst.svg' },
  local_redraw: { image: '/workbench/jbch.webp', icon: '/workbench/icons/m_jbch.svg' },
  expand: { image: '/workbench/znkt.webp', icon: '/workbench/icons/m_znkt.svg' },
  matting: { image: '/workbench/bjxc.webp', icon: '/workbench/icons/m_bjxc.svg' },
  remove_watermark: { image: '/workbench/qcsy.webp', icon: '/workbench/icons/m_qcsy.svg' },
  image_translate: { image: '/workbench/tpfy.webp', icon: '/workbench/icons/m_tpfy.svg' },
  enhance: { image: '/workbench/cpjx.webp', icon: '/workbench/icons/m_cpjx.svg' },
  recolor: { image: '/workbench/sphs.webp', icon: '/workbench/icons/m_sphs.svg' },
  rotate: { image: '/workbench/xzjd.webp', icon: '/workbench/icons/m_jdxz.svg' },
  template: {
    image: '/templates/wedding/longfeng-01-red-wall-fan.webp',
    icon: '/workbench/icons/m_cyst.svg',
  },
};

/**
 * 数据面板 6 格指标 (参考站 `.wb-dashboard-stats` 为 repeat(6) 六格)。
 * 全部取自真实统计接口, 无占位数字。
 */
export const DASH_TILES: {
  label: string;
  value: (s: StatsOverview) => string | number;
  foot: (s: StatsOverview) => string;
}[] = [
  { label: '累计生成', value: (s) => s.totals.tasks, foot: (s) => `成功 ${s.totals.succeeded}` },
  {
    label: '成功率',
    value: (s) => (s.totals.successRate === null ? '—' : `${s.totals.successRate}%`),
    foot: () => '成功 / 全部任务',
  },
  { label: '素材库存', value: (s) => s.totals.assets, foot: (s) => `原图 ${s.totals.originals}` },
  { label: '生成图', value: (s) => s.totals.generated, foot: () => '可下载原图' },
  { label: '失败任务', value: (s) => s.totals.failed, foot: () => '可重试' },
  {
    label: '近 7 天',
    value: (s) => s.last7Days.reduce((a, d) => a + d.count, 0),
    foot: () => '张图片产出',
  },
];

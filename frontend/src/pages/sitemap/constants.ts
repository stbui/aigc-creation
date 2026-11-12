/**
 * 网站地图页面的常量与静态数据 —— 目录内文件的唯一常量入口。
 *
 * 分组与条目按**本项目真实路由**填充（参考站列的是它自己的路由，本项目没有
 * /my-works，也没有独立 /packages —— 套餐已并入营销首页），避免出现指向
 * 不存在页面的链接。带 `capability` 的条目会跟随能力运行时可见性隐藏。
 */

export const SITEMAP_PAGE_META = {
  title: '网站地图 · 货觉AI',
  description: '货觉AI 全部页面与工具入口索引。',
} as const;

export interface SitemapLink {
  name: string;
  to: string;
  path: string;
  capability?: string;
}

export interface SitemapSection {
  no: string;
  label: string;
  title: string;
  color: string;
  links: SitemapLink[];
}

export const SECTIONS: SitemapSection[] = [
  {
    no: '01',
    label: 'START HERE',
    title: '首页与创作入口',
    color: 'var(--sitemap-accent-1)',
    links: [
      { name: '营销首页', to: '/', path: '/' },
      { name: '工作台', to: '/workbench', path: '/workbench' },
      { name: '商品主图', to: '/product-kit', path: '/product-kit', capability: 'main_image' },
      { name: '商品详情图', to: '/product-detail', path: '/product-detail', capability: 'detail_image' },
      { name: '爆款复刻', to: '/viral-clone', path: '/viral-clone', capability: 'hot_remake' },
      {
        name: '创意生图',
        to: '/creative-image',
        path: '/creative-image',
        capability: 'creative_image',
      },
      { name: '自由创作', to: '/free-creation', path: '/free-creation', capability: 'free_create' },
    ],
  },
  {
    no: '02',
    label: 'CREATE TOOLS',
    title: 'AI 图片工具',
    color: 'var(--sitemap-accent-2)',
    links: [
      { name: '局部重绘', to: '/local-redraw', path: '/local-redraw', capability: 'local_redraw' },
      { name: '去除水印', to: '/watermark-remove', path: '/watermark-remove', capability: 'remove_watermark' },
      { name: '一键抠图', to: '/background-remove', path: '/background-remove', capability: 'matting' },
      { name: '产品精修', to: '/product-retouch', path: '/product-retouch', capability: 'enhance' },
      { name: '图片翻译', to: '/image-translate', path: '/image-translate', capability: 'image_translate' },
      { name: '智能扩图', to: '/image-expand', path: '/image-expand', capability: 'expand' },
      { name: '商品换色', to: '/product-recolor', path: '/product-recolor', capability: 'recolor' },
      { name: '旋转角度', to: '/rotate-angle', path: '/rotate-angle', capability: 'rotate' },
    ],
  },
  {
    no: '03',
    label: 'YOUR SPACE',
    title: '账户与内容',
    color: 'var(--sitemap-accent-3)',
    links: [
      { name: '我的作品', to: '/works', path: '/works' },
      { name: '素材库', to: '/library', path: '/library' },
      { name: '数据中心', to: '/stats', path: '/stats' },
      { name: '积分商城', to: '/packages', path: '/packages' },
      { name: '积分明细', to: '/credits', path: '/credits' },
      { name: '我的订单', to: '/orders', path: '/orders' },
      { name: '账户设置', to: '/account', path: '/account' },
      { name: '邀请有奖', to: '/invitations', path: '/invitations' },
      { name: '我的工单', to: '/tickets', path: '/tickets' },
      { name: '多图融合', to: '/multi-image-fusion', path: '/multi-image-fusion', capability: 'multi_fusion' },
      { name: '商品SKU图', to: '/product-sku', path: '/product-sku', capability: 'sku_image' },
    ],
  },
  {
    no: '04',
    label: 'ABOUT THE SITE',
    title: '站点页面',
    color: 'var(--sitemap-accent-4)',
    links: [
      { name: '网站地图', to: '/sitemap.html', path: '/sitemap.html' },
      { name: '投诉举报', to: '/tickets?type=complaint&compose=1', path: '/tickets?type=complaint&compose=1' },
    ],
  },
];

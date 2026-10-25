import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { isCapabilityVisible } from '../lib/capabilities';
import { useCapabilities } from '../hooks/useCapabilities';

/**
 * 网站地图 —— 复刻参考站 https://ijihua.cn/sitemap.html
 *
 * 版面数值来自参考站实拍 (2026-10-17, 1280 视口):
 *   顶部条: 品牌 + 「机器地图 XML」(/sitemap.xml) + 「返回首页 ↗」
 *   hero 1100x172: eyebrow「IJIHUA / SITE INDEX」+ h1「网站地图.」
 *     68px/780 #182033 lh66.64; 下方 15px 说明文案
 *   主体 main 1100, 两列网格 (各列起点 x=162 / x=721)
 *   每组: 编号小标 10px/750 letterSpacing 1.2 (四组四色)
 *     #625DF5 / rgb(42,168,192) / rgb(230,134,98) / rgb(53,168,137)
 *     + 组标题 17px/720 #182033 + 条目数
 *   条目 li 491x38 display list-item: 名称 16px #182033 + 路径 11px #9AA1B1
 *   页脚: © 2026 + 「查看 XML Sitemap ↗」
 *
 * 分组与条目按**本项目真实路由**填充（参考站列的是它自己的路由，本项目没有 /my-works、
 * 也没有独立 /packages —— 套餐已并入营销首页），避免出现指向不存在页面的链接。
 */

interface SitemapSection {
  no: string;
  label: string;
  title: string;
  color: string;
  links: { name: string; to: string; path: string; capability?: string }[];
}

const SECTIONS: SitemapSection[] = [
  {
    no: '01',
    label: 'START HERE',
    title: '首页与创作入口',
    color: '#625df5',
    links: [
      { name: '营销首页', to: '/', path: '/' },
      { name: '工作台', to: '/workbench', path: '/workbench' },
      { name: '商品主图', to: '/product-kit', path: '/product-kit', capability: 'main_image' },
      { name: '商品详情图', to: '/product-detail', path: '/product-detail', capability: 'detail_image' },
      { name: '爆款复刻', to: '/viral-clone', path: '/viral-clone', capability: 'hot_remake' },
      { name: '创意生图', to: '/free-creation', path: '/free-creation' },
      { name: '自由创作', to: '/free-creation', path: '/free-creation', capability: 'free_create' },
    ],
  },
  {
    no: '02',
    label: 'CREATE TOOLS',
    title: 'AI 图片工具',
    color: '#2aa8c0',
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
    color: '#e68662',
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
    color: '#35a889',
    links: [
      { name: '网站地图', to: '/sitemap.html', path: '/sitemap.html' },
      { name: '用户协议', to: '/legal/user-agreement.html', path: '/legal/user-agreement.html' },
      { name: '隐私政策', to: '/legal/privacy-policy.html', path: '/legal/privacy-policy.html' },
      { name: '账号规则', to: '/legal/account-rules.html', path: '/legal/account-rules.html' },
      { name: '未成年人保护', to: '/legal/minors-policy.html', path: '/legal/minors-policy.html' },
      { name: '投诉举报', to: '/tickets?type=complaint&compose=1', path: '/tickets?type=complaint&compose=1' },
    ],
  },
];

export function SitemapPage() {
  const { data } = useCapabilities();
  const sections = useMemo(() => {
    if (!data) return SECTIONS;
    const visible = new Set(data.items.filter(isCapabilityVisible).map((c) => c.id));
    return SECTIONS.map((s) => ({
      ...s,
      links: s.links.filter((l) => !l.capability || visible.has(l.capability)),
    })).filter((s) => s.links.length > 0);
  }, [data]);

  return (
    <div className="sitemap-page">
      <header className="sitemap-topbar">
        <Link to="/" className="sitemap-topbar-brand">
          {/* 品牌标记: 货觉AI「觉眼」logo (2026-10-19, 见 docs/brand/brand-basics.md) */}
          <img src="/brand/huojue-mark.svg" alt="货觉AI" className="sitemap-topbar-brand-mark" />
          <span>
            货觉<span className="sitemap-topbar-brand-ai">AI</span>
          </span>
        </Link>
        <div className="sitemap-topbar-right">
          <span className="sitemap-topbar-note">本页即站点索引，无需 XML</span>
          <Link to="/" className="sitemap-topbar-link">
            返回首页 ↗
          </Link>
        </div>
      </header>

      <main className="sitemap-main">
        <section className="sitemap-hero">
          <span className="sitemap-eyebrow">HUOJUE AI / SITE INDEX</span>
          <h1>网站地图.</h1>
          <p>
            这里汇总货觉AI当前网站的页面地址，按创作入口、AI 工具、账户内容和站点页面分组，
            方便快速找到需要的功能。
          </p>
        </section>

        <div className="sitemap-grid">
          {sections.map((s) => (
            <section key={s.no} className="sitemap-section">
              <span className="sitemap-section-no" style={{ color: s.color }}>
                {s.no} / {s.label}
              </span>
              <div className="sitemap-section-head">
                <h2>{s.title}</h2>
                <span>{s.links.length} 个</span>
              </div>
              <ul className="sitemap-list">
                {s.links.map((l) => (
                  <li key={l.to + l.name}>
                    <Link to={l.to} className="sitemap-item">
                      <span className="sitemap-item-name">{l.name}</span>
                      <span className="sitemap-item-path">{l.path}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>

      <footer className="sitemap-footer">
        <span>© 2026 货觉AI</span>
        <span className="sitemap-footer-note">
          路由结构对齐参考站设计；条目为本站真实路由
        </span>
      </footer>
    </div>
  );
}

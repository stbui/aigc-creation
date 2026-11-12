import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { A } from './constants';

interface LandingFeaturesProps {
  /** 能力运行时可见性：已下线工具不再给 CTA */
  canUse: (capability: string) => boolean;
}

/** 产品特性：宽卡 + 两张补充卡，CTA 跟随能力可见性。 */
export function LandingFeatures({ canUse }: LandingFeaturesProps) {
  const navigate = useNavigate();

  return (
    <section className="lp-section">
      <header className="lp-section-head is-center">
        <span className="lp-kicker">产品特性</span>
        <h2>为电商而生的 AI 作图工作台</h2>
        <p>上传、生成、下载，全流程在同一个页面完成。</p>
      </header>
      <article className="lp-feature-wide">
        <div className="lp-feature-copy">
          <h3>一张商品图，搞定全套图</h3>
          <ul>
            <li>省下布景、拍摄、修图的重复成本</li>
            <li>一张图延展多套视觉，快速测试点击率</li>
            <li>风格统一，适合店铺、广告、详情页同步使用</li>
          </ul>
          {canUse('main_image') && (
            <button
              type="button"
              className="lp-btn lp-btn-primary"
              onClick={() => navigate('/product-kit')}
            >
              去试试
              <ArrowRight size={15} aria-hidden />
            </button>
          )}
        </div>
        <div className="lp-feature-media">
          {/* 参考站该区是 banner 背景图内嵌, 本项目改用真实产出拼贴(诚实替代)。
              网格为 4 列 2 行: 主图跨 2x2 占 4 格, 余 4 格各放一张 → 共 5 张, 不留空行 */}
          <img
            className="lp-feature-main"
            src={`${A}/feat/top_01.png`}
            alt=""
            width={1254}
            height={1254}
            loading="lazy"
          />
          <img src={`${A}/feat/left_01.png`} alt="" width={800} height={800} loading="lazy" />
          <img src={`${A}/feat/right_02.png`} alt="" width={800} height={800} loading="lazy" />
          <img src={`${A}/feat/top_02.png`} alt="" width={1254} height={1254} loading="lazy" />
          <img src={`${A}/feat/top_03.png`} alt="" width={1254} height={1254} loading="lazy" />
        </div>
      </article>
      <div className="lp-feature-grid">
        <article className="lp-feature-card">
          <h3>一键生成完整的电商详情图组</h3>
          <ul>
            <li>把参数和卖点转成可视化内容</li>
            <li>模块化输出，方便直接排版落地</li>
            <li>提升页面完整度，减少设计制作时间</li>
          </ul>
          {canUse('detail_image') && (
            <button
              type="button"
              className="lp-text-link"
              onClick={() => navigate('/product-detail')}
            >
              去试试
              <ArrowRight size={14} aria-hidden />
            </button>
          )}
        </article>
        <article className="lp-feature-card">
          <h3>复刻爆款图的设计风格</h3>
          <ul>
            <li>拆解爆款视觉逻辑，降低试错成本</li>
            <li>跟款上新更快，趋势不掉队</li>
            <li>保留原图氛围，替换主体不违和</li>
          </ul>
          {canUse('hot_remake') && (
            <button
              type="button"
              className="lp-text-link"
              onClick={() => navigate('/viral-clone')}
            >
              去试试
              <ArrowRight size={14} aria-hidden />
            </button>
          )}
        </article>
      </div>
    </section>
  );
}

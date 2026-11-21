import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { A } from './constants';
import { Button, Surface, SurfaceContent, TextAction } from './components';
import { LandingHeading, LandingKicker, LandingLede, LandingSection } from './LandingSection';

interface LandingFeaturesProps {
  /** 能力运行时可见性：已下线工具不再给 CTA */
  canUse: (capability: string) => boolean;
}

/**
 * 产品特性：宽卡 + 两张补充卡，CTA 跟随能力可见性。
 *
 * 要点列表用品牌紫小圆点做标记 —— 这是文案排版，不是控件；两处 CTA
 * 分别是 `Button asChild`（实心）与 `TextAction asChild`（行内）。
 */
export function LandingFeatures({ canUse }: LandingFeaturesProps) {
  return (
    <LandingSection>
      <div className="max-w-[640px] text-center mx-auto">
        <LandingKicker>产品特性</LandingKicker>
        <LandingHeading>为电商而生的 AI 作图工作台</LandingHeading>
        <LandingLede>上传、生成、下载，全流程在同一个页面完成。</LandingLede>
      </div>

      <div className="mt-8 text-left">
        <Surface className="grid grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)] items-center gap-8 rounded-2xl border-border px-7 py-7 max-[1080px]:grid-cols-1 max-[640px]:px-5">
          <div>
            <h3 className="m-0 text-[21px] font-bold tracking-[-0.3px] text-foreground">
              一张商品图，搞定全套图
            </h3>
            <FeaturePoints
              points={[
                '省下布景、拍摄、修图的重复成本',
                '一张图延展多套视觉，快速测试点击率',
                '风格统一，适合店铺、广告、详情页同步使用',
              ]}
            />
            {canUse('main_image') && (
              <Button
                asChild
                className="mt-6 h-10.5 gap-1.5 px-5 text-[14.5px] font-semibold hover:bg-brand-hover"
              >
                <Link to="/product-kit">
                  去试试
                  <ArrowRight size={15} aria-hidden />
                </Link>
              </Button>
            )}
          </div>

          {/* 参考站该区是 banner 背景图内嵌, 本项目改用真实产出拼贴(诚实替代)。
              网格为 4 列 2 行: 主图跨 2x2 占 4 格, 余 4 格各放一张 → 共 5 张, 不留空行。
              容器给定 2:1 比例, 行高才解析为 1fr, 主图不会被拉成碎片。 */}
          <div className="grid aspect-[2/1] max-h-[520px] grid-cols-4 grid-rows-2 gap-2.5">
            <img
              className="col-span-2 row-span-2 size-full rounded-lg bg-muted object-cover"
              src={`${A}/feat/top_01.png`}
              alt=""
              width={1254}
              height={1254}
              loading="lazy"
            />
            {[
              `${A}/feat/left_01.png`,
              `${A}/feat/right_02.png`,
              `${A}/feat/top_02.png`,
              `${A}/feat/top_03.png`,
            ].map((src) => (
              <img
                key={src}
                className="size-full rounded-lg bg-muted object-cover"
                src={src}
                alt=""
                width={800}
                height={800}
                loading="lazy"
              />
            ))}
          </div>
        </Surface>

        <div className="mt-5 grid grid-cols-2 gap-5 max-[640px]:grid-cols-1">
          {[
            {
              title: '一键生成完整的电商详情图组',
              points: [
                '把参数和卖点转成可视化内容',
                '模块化输出，方便直接排版落地',
                '提升页面完整度，减少设计制作时间',
              ],
              capability: 'detail_image',
              to: '/product-detail',
            },
            {
              title: '复刻爆款图的设计风格',
              points: [
                '拆解爆款视觉逻辑，降低试错成本',
                '跟款上新更快，趋势不掉队',
                '保留原图氛围，替换主体不违和',
              ],
              capability: 'hot_remake',
              to: '/viral-clone',
            },
          ].map((card) => (
            <Surface
              key={card.title}
              className="items-start gap-0 rounded-2xl border-border px-7 py-7 max-[640px]:px-5"
            >
              <SurfaceContent className="flex flex-1 flex-col items-start px-0">
                <h3 className="m-0 text-[21px] font-bold tracking-[-0.3px] text-foreground">
                  {card.title}
                </h3>
                <FeaturePoints points={card.points} />
                {canUse(card.capability) && (
                  <TextAction asChild className="mt-auto pt-5.5 font-semibold">
                    <Link to={card.to}>
                      去试试
                      <ArrowRight size={14} aria-hidden />
                    </Link>
                  </TextAction>
                )}
              </SurfaceContent>
            </Surface>
          ))}
        </div>
      </div>
    </LandingSection>
  );
}

/** 特性要点列表：品牌紫小圆点 + 13.5px 说明文字 */
function FeaturePoints({ points }: { points: string[] }) {
  return (
    <ul className="mt-4 flex list-none flex-col gap-2.5 p-0">
      {points.map((point) => (
        <li
          key={point}
          className="relative pl-4.5 text-[13.5px] leading-[1.6] text-muted-foreground before:absolute before:top-1.75 before:left-0 before:size-1.5 before:rounded-full before:bg-brand before:content-['']"
        >
          {point}
        </li>
      ))}
    </ul>
  );
}

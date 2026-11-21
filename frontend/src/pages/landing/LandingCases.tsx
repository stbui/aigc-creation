import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { A, type CaseGroup } from './constants';
import { caseTarget, uniqueCaseFiles } from './utils';
import { AspectRatio, Badge, TextAction } from './components';
import { LandingHeading, LandingKicker, LandingSection } from './LandingSection';

interface LandingCasesProps {
  groups: CaseGroup[];
}

/**
 * 优秀案例：分类平铺长式依次陈列，不切页签。
 *
 * 每个分类按商品去重后只陈列 5 张 —— 访客不必猜「别的能力能不能做」。
 *
 * 卡片是「点击即跳同款工具页」的整块入口：用 `Link` + `AspectRatio` 保证 3:4
 * 画幅与焦点环，悬停浮出的「做同款」是 `Badge`（纯展示标签，不是第二枚按钮）；
 * 键盘聚焦同样浮出，35 张常驻标签会变成噪音。
 */
export function LandingCases({ groups }: LandingCasesProps) {
  return (
    <LandingSection>
      <div className="flex flex-wrap items-end justify-between gap-6 max-[900px]:flex-col max-[900px]:items-start max-[900px]:gap-4">
        <div>
          <LandingKicker>优秀案例</LandingKicker>
          <LandingHeading>看看工具能做出什么</LandingHeading>
        </div>
      </div>

      <div className="mt-9 grid gap-10 max-[640px]:mt-7 max-[640px]:gap-7.5">
        {groups.map((group) => {
          const target = caseTarget(group.key);
          return (
            <article key={group.key}>
              <header className="mb-3.5 flex items-center justify-between gap-4">
                <h3 className="m-0 text-[17px] font-semibold tracking-[-0.2px] text-foreground">
                  {group.label}
                </h3>
                <TextAction asChild className="font-semibold">
                  <Link to={target}>
                    做同款
                    <ArrowRight size={14} aria-hidden />
                  </Link>
                </TextAction>
              </header>

              <div className="grid grid-cols-5 gap-3.5 max-[900px]:grid-cols-3 max-[640px]:grid-cols-2 max-[640px]:gap-2.5">
                {uniqueCaseFiles(group.files)
                  .slice(0, 5)
                  .map((file) => (
                    <Link
                      key={file}
                      aria-label={`${group.label}示例，做同款`}
                      to={target}
                      className="group relative block rounded-lg no-underline"
                    >
                      <AspectRatio ratio={3 / 4} className="overflow-hidden rounded-lg bg-muted">
                        {/* 按钮已有 aria-label, 图片作为卡面内容不再重复同一句 alt */}
                        <img
                          src={`${A}/case/${file}`}
                          alt=""
                          width={600}
                          height={800}
                          loading="lazy"
                          className="block size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        />
                        <Badge className="absolute bottom-2.5 left-2.5 h-auto translate-y-1 rounded-full bg-[color-mix(in_srgb,var(--text-strong)_70%,transparent)] px-2.5 py-1 text-xs font-medium text-card opacity-0 backdrop-blur-[6px] transition-[opacity,transform] duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                          做同款
                        </Badge>
                      </AspectRatio>
                    </Link>
                  ))}
              </div>
            </article>
          );
        })}
      </div>
    </LandingSection>
  );
}

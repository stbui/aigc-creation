import type { ReactNode } from 'react';

/**
 * 页面段落骨架：容器 1200、上间距 88、居中。
 *
 * 这不是控件，是首页 8 个区块共用的几何约定（排布而非外观），所以留在
 * 页面内做一个小型组合件，而不是往 `ui/primitives` 加一个只有本页消费的组件。
 * `tight` 用于紧跟上一段的窄间距区块（修图工具 / 使用流程）。
 */
export function LandingSection({
  children,
  tight = false,
  id,
}: {
  children: ReactNode;
  tight?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`mx-auto max-w-[1200px] px-6 max-[900px]:px-5 ${
        tight ? 'pt-14 max-[900px]:pt-11' : 'pt-22'
      }`}
    >
      {children}
    </section>
  );
}

/** 段落眉标：12.5px / 700 / 0.14em 字距的品牌紫小标题 */
export function LandingKicker({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block text-[12.5px] font-bold tracking-[0.14em] text-brand">
      {children}
    </span>
  );
}

/** 段落标题：30px / 700 */
export function LandingHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-2.5 text-[30px] leading-[1.3] font-bold tracking-[-0.6px] text-foreground">
      {children}
    </h2>
  );
}

/** 段落说明：14.5px / 1.75 */
export function LandingLede({ children }: { children: ReactNode }) {
  return <p className="mt-2.5 text-[14.5px] leading-[1.75] text-muted-foreground">{children}</p>;
}
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface SectionCardProps {
  /** 分组标题；省略则不渲染标题行（标题由卡片内容自带，如图片上传区） */
  title?: ReactNode;
  /** 标题行右侧的补充信息，如张数合计、动作按钮 */
  extra?: ReactNode;
  /** 标题元素语义；工具页沿用 h2，配置分组默认 strong */
  titleAs?: 'strong' | 'h2';
  children: ReactNode;
  className?: string;
  /** 标题行布局类；页面需要调整标题行外边距时覆盖 */
  headerClassName?: string;
  /** 标题字级类；页面需要调整标题行高 / 字号时覆盖 */
  titleClassName?: string;
  /** 内容区布局类；默认 `grid gap-4`，卡片内容需要更紧的间距时覆盖 */
  contentClassName?: string;
}

/**
 * C 端配置卡：白底面板 + 标题行 + 内容区。
 *
 * 工具页里的「自定义配置」「生成设置」「商品描述」这类分组共用同一套外壳。
 * 此前由页面级白卡 / 分组 class 拼出结构和字号，每个调用点都要抄一遍标题行；
 * 现在外观与间距收在本组件，页面只表达分组标题、右侧补充信息和组内控件。
 *
 * 标题由卡片内容自带时（如 `ImageUploadHeader`）不传 `title`，只复用面板与内边距。
 */
export function SectionCard({
  title,
  extra,
  titleAs = 'strong',
  children,
  className,
  headerClassName,
  titleClassName,
  contentClassName,
}: SectionCardProps) {
  const titleClass = cn('m-0 text-sm leading-[22px] font-bold text-foreground', titleClassName);
  return (
    <section
      data-slot="section-card"
      className={cn('grid min-w-0 gap-4 rounded-xl bg-card p-4', className)}
    >
      {title != null || extra != null ? (
        <div className={cn('flex items-center justify-between gap-3', headerClassName)}>
          {titleAs === 'h2' ? (
            <h2 className={titleClass}>{title}</h2>
          ) : (
            <strong className={titleClass}>{title}</strong>
          )}
          {extra != null ? (
            <div className="flex shrink-0 items-center gap-3 text-xs leading-[13px] text-muted-foreground">
              {extra}
            </div>
          ) : null}
        </div>
      ) : null}
      <div data-slot="section-card-content" className={cn('grid gap-4', contentClassName)}>
        {children}
      </div>
    </section>
  );
}

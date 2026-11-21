import type { ComponentProps } from 'react';

import { Button } from '~/admin-ui/components/ui/button';
import { cn } from '../lib/cn';

export interface TextActionProps extends ComponentProps<typeof Button> {
  /** 前置图标（lucide 图标组件）；`size="xs"` 时按 12px 渲染 */
  icon?: ComponentProps<typeof Button>['children'];
}

/**
 * C 端行内文字动作 / 文字链接。
 *
 * 工具卡片的「从素材库导入」「手机上传」「清空框选」这类入口视觉上是文字链接，
 * 语义上仍是按钮（无 href、不改变路由），因此不改用 `<a>`，而是把 shadcn
 * `Button variant="link"` 的密度收敛到 12px 行内：去掉高度、内边距与下划线的
 * 多样化写法，调用点只表达文案与动作。
 *
 * 需要改变路由时传 `asChild` 并把 `<Link>` 作为唯一子元素 —— 外观留在本组件、
 * 语义交给链接，读屏识别为链接，也支持新标签页打开。
 *
 * 业务组件不得再手写 `variant="link" size="xs" className="h-auto …"` 的组合。
 */
export function TextAction({
  className,
  icon,
  asChild = false,
  children,
  ...props
}: TextActionProps) {
  return (
    <Button
      // `asChild` 时子元素可能是 `<Link>`：`type="button"` 落到链接上是无效属性
      {...(asChild ? { asChild } : { type: 'button' as const })}
      variant="link"
      size="xs"
      className={cn(
        'h-auto gap-1 p-0 text-xs font-normal text-muted-foreground no-underline underline-offset-4',
        'hover:text-brand hover:underline disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </Button>
  );
}

/**
 * progress —— shadcn/ui (new-york-v4) 组件，自持副本。
 *
 * 来源：https://ui.shadcn.com/r/styles/new-york-v4/progress.json
 *
 * 相对上游的改动：
 *   - `from "cn"` → `from "~/admin-ui/lib/cn"`（用项目自有的类名合并，
 *     与 BoardUI vendor 共用同一份 tailwind-merge 规则）
 *   - 剥掉全部 `dark:` 变体：本项目全站无暗色模式，而 Tailwind v4 的
 *     `dark:` 默认走 `prefers-color-scheme: media`，系统开暗色时只有
 *     shadcn 组件变暗，会破版
 */
"use client"

import * as React from "react"
import { cn } from "~/admin-ui/lib/cn"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
 className,
 value,
 ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
 return (
 <ProgressPrimitive.Root
 data-slot="progress"
 className={cn(
 "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
 className
 )}
 {...props}
 >
 <ProgressPrimitive.Indicator
 data-slot="progress-indicator"
 className="h-full w-full flex-1 bg-primary transition-all"
 style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
 />
 </ProgressPrimitive.Root>
 )
}

export { Progress }

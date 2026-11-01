/**
 * separator —— shadcn/ui (new-york-v4) 组件，自持副本。
 *
 * 来源：https://ui.shadcn.com/r/styles/new-york-v4/separator.json
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
import { Separator as SeparatorPrimitive } from "radix-ui"

function Separator({
 className,
 orientation = "horizontal",
 decorative = true,
 ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
 return (
 <SeparatorPrimitive.Root
 data-slot="separator"
 decorative={decorative}
 orientation={orientation}
 className={cn(
 "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
 className
 )}
 {...props}
 />
 )
}

export { Separator }

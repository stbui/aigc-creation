/**
 * scroll-area —— shadcn/ui (new-york-v4) 组件，自持副本。
 *
 * 来源：https://ui.shadcn.com/r/styles/new-york-v4/scroll-area.json
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
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

function ScrollArea({
 className,
 children,
 ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
 return (
 <ScrollAreaPrimitive.Root
 data-slot="scroll-area"
 className={cn("relative", className)}
 {...props}
 >
 <ScrollAreaPrimitive.Viewport
 data-slot="scroll-area-viewport"
 className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
 >
 {children}
 </ScrollAreaPrimitive.Viewport>
 <ScrollBar />
 <ScrollAreaPrimitive.Corner />
 </ScrollAreaPrimitive.Root>
 )
}

function ScrollBar({
 className,
 orientation = "vertical",
 ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
 return (
 <ScrollAreaPrimitive.ScrollAreaScrollbar
 data-slot="scroll-area-scrollbar"
 orientation={orientation}
 className={cn(
 "flex touch-none p-px transition-colors select-none",
 orientation === "vertical" &&
 "h-full w-2.5 border-l border-l-transparent",
 orientation === "horizontal" &&
 "h-2.5 flex-col border-t border-t-transparent",
 className
 )}
 {...props}
 >
 <ScrollAreaPrimitive.ScrollAreaThumb
 data-slot="scroll-area-thumb"
 className="relative flex-1 rounded-full bg-border"
 />
 </ScrollAreaPrimitive.ScrollAreaScrollbar>
 )
}

export { ScrollArea, ScrollBar }

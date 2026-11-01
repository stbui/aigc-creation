/**
 * tooltip —— shadcn/ui (new-york-v4) 组件，自持副本。
 *
 * 来源：https://ui.shadcn.com/r/styles/new-york-v4/tooltip.json
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
import { Tooltip as TooltipPrimitive } from "radix-ui"

function TooltipProvider({
 delayDuration = 0,
 ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
 return (
 <TooltipPrimitive.Provider
 data-slot="tooltip-provider"
 delayDuration={delayDuration}
 {...props}
 />
 )
}

function Tooltip({
 ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
 return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
 ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
 return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
 className,
 sideOffset = 0,
 children,
 ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
 return (
 <TooltipPrimitive.Portal>
 <TooltipPrimitive.Content
 data-slot="tooltip-content"
 sideOffset={sideOffset}
 className={cn(
 "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
 className
 )}
 {...props}
 >
 {children}
 <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
 </TooltipPrimitive.Content>
 </TooltipPrimitive.Portal>
 )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

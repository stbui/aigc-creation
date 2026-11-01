/**
 * switch —— shadcn/ui (new-york-v4) 组件，自持副本。
 *
 * 来源：https://ui.shadcn.com/r/styles/new-york-v4/switch.json
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
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
 className,
 size = "default",
 ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
 size?: "sm" | "default"
}) {
 return (
 <SwitchPrimitive.Root
 data-slot="switch"
 data-size={size}
 className={cn(
 "peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input ",
 className
 )}
 {...props}
 >
 <SwitchPrimitive.Thumb
 data-slot="switch-thumb"
 className={cn(
 "pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 "
 )}
 />
 </SwitchPrimitive.Root>
 )
}

export { Switch }

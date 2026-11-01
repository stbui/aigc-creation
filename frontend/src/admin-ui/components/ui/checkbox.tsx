/**
 * checkbox —— shadcn/ui (new-york-v4) 组件，自持副本。
 *
 * 来源：https://ui.shadcn.com/r/styles/new-york-v4/checkbox.json
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
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

function Checkbox({
 className,
 ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
 return (
 <CheckboxPrimitive.Root
 data-slot="checkbox"
 className={cn(
 "peer size-4 shrink-0 rounded-[4px] border border-input shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground ",
 className
 )}
 {...props}
 >
 <CheckboxPrimitive.Indicator
 data-slot="checkbox-indicator"
 className="grid place-content-center text-current transition-none"
 >
 <CheckIcon className="size-3.5" />
 </CheckboxPrimitive.Indicator>
 </CheckboxPrimitive.Root>
 )
}

export { Checkbox }

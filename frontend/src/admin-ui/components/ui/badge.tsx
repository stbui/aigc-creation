/**
 * badge —— shadcn/ui (new-york-v4) 组件，自持副本。
 *
 * 来源：https://ui.shadcn.com/r/styles/new-york-v4/badge.json
 *
 * 相对上游的改动：
 *   - `from "cn"` → `from "~/admin-ui/lib/cn"`（用项目自有的类名合并，
 *     与 BoardUI vendor 共用同一份 tailwind-merge 规则）
 *   - 剥掉全部 `dark:` 变体：本项目全站无暗色模式，而 Tailwind v4 的
 *     `dark:` 默认走 `prefers-color-scheme: media`，系统开暗色时只有
 *     shadcn 组件变暗，会破版
 */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "~/admin-ui/lib/cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
 "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3",
 {
 variants: {
 variant: {
 default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
 secondary:
 "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
 destructive:
 "bg-destructive text-white focus-visible:ring-destructive/20 [a&]:hover:bg-destructive/90",
 outline:
 "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
 ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
 link: "text-primary underline-offset-4 [a&]:hover:underline",
 },
 },
 defaultVariants: {
 variant: "default",
 },
 }
)

function Badge({
 className,
 variant = "default",
 asChild = false,
 ...props
}: React.ComponentProps<"span"> &
 VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
 const Comp = asChild ? Slot.Root : "span"

 return (
 <Comp
 data-slot="badge"
 data-variant={variant}
 className={cn(badgeVariants({ variant }), className)}
 {...props}
 />
 )
}

export { Badge, badgeVariants }

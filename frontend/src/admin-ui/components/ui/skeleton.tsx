/**
 * skeleton —— shadcn/ui (new-york-v4) 组件，自持副本。
 *
 * 来源：https://ui.shadcn.com/r/styles/new-york-v4/skeleton.json
 *
 * 相对上游的改动：
 *   - `from "cn"` → `from "~/admin-ui/lib/cn"`（用项目自有的类名合并，
 *     与 BoardUI vendor 共用同一份 tailwind-merge 规则）
 *   - 剥掉全部 `dark:` 变体：本项目全站无暗色模式，而 Tailwind v4 的
 *     `dark:` 默认走 `prefers-color-scheme: media`，系统开暗色时只有
 *     shadcn 组件变暗，会破版
 */
import { cn } from "~/admin-ui/lib/cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
 return (
 <div
 data-slot="skeleton"
 className={cn("animate-pulse rounded-md bg-accent", className)}
 {...props}
 />
 )
}

export { Skeleton }

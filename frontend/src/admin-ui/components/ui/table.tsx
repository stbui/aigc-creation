/**
 * table —— shadcn/ui (new-york-v4) 组件，自持副本。
 *
 * 来源：https://ui.shadcn.com/r/styles/new-york-v4/table.json
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

function Table({ className, ...props }: React.ComponentProps<"table">) {
 return (
 <div
 data-slot="table-container"
 className="relative w-full overflow-x-auto"
 >
 <table
 data-slot="table"
 className={cn("w-full caption-bottom text-sm", className)}
 {...props}
 />
 </div>
 )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
 return (
 <thead
 data-slot="table-header"
 className={cn("[&_tr]:border-b", className)}
 {...props}
 />
 )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
 return (
 <tbody
 data-slot="table-body"
 className={cn("[&_tr:last-child]:border-0", className)}
 {...props}
 />
 )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
 return (
 <tfoot
 data-slot="table-footer"
 className={cn(
 "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
 className
 )}
 {...props}
 />
 )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
 return (
 <tr
 data-slot="table-row"
 className={cn(
 "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
 className
 )}
 {...props}
 />
 )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
 return (
 <th
 data-slot="table-head"
 className={cn(
 "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
 className
 )}
 {...props}
 />
 )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
 return (
 <td
 data-slot="table-cell"
 className={cn(
 "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
 className
 )}
 {...props}
 />
 )
}

function TableCaption({
 className,
 ...props
}: React.ComponentProps<"caption">) {
 return (
 <caption
 data-slot="table-caption"
 className={cn("mt-4 text-sm text-muted-foreground", className)}
 {...props}
 />
 )
}

export {
 Table,
 TableHeader,
 TableBody,
 TableFooter,
 TableHead,
 TableRow,
 TableCell,
 TableCaption,
}

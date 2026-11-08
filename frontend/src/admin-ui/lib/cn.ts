/**
 * 后台类名合并的唯一出口。
 *
 * 实现是官方 npm 包 `cn`（shadcn 官方当前做法），这里用 `createCn` 在官方默认
 * 合并表上**补登本项目 `@theme` 里自造的 token**，其余行为与默认表逐字一致。
 *
 * ## 为什么必须补登
 *
 * `cn` 的冲突表按 Tailwind **默认**主题编译。`styles/admin.css` 的 `@theme inline`
 * 里新增的名字它不认识，于是同名不同值的类不会被判定为冲突：
 *
 *   cn('shadow-card', 'shadow-none')  // 默认表 → "shadow-card shadow-none"，两者并存
 *                                     // 补登后 → "shadow-none"（后者覆盖前者，符合预期）
 *
 * 颜色的情况恰好不出错（`text-danger-text` 与 `text-sm` 分属颜色组与字号组，
 * 官方表已经分得开），但 `shadow` 是一组封闭枚举，不补登就丢不掉旧值。
 *
 * ## 与 `components.json` 的关系
 *
 * `aliases.utils` 指向本文件：shadcn CLI 装组件时，若源码「用了 `cn()` 却没 import」，
 * 会注入 `import { cn } from "~/admin-ui/lib/cn"`。但官方注册表的组件自带
 * `import { cn } from "cn"`，**不会**自动改指向 —— 由 `scripts/post-shadcn.mjs`
 * 在每次 `shadcn add` 之后统一改写成本文件。直接改组件源码而不跑脚本，等于绕过补登表。
 */

import { createCn } from 'cn/config';

/** 与 `styles/admin.css` 的 `@theme inline` 保持一一对应。 */
const cn = createCn({
  extend: {
    theme: {
      // 封闭枚举：不补登，`shadow-card` 与 `shadow-none` 会同时生效
      shadow: ['card'],
      color: [
        'brand',
        'brand-hover',
        'brand-bg',
        'brand-light',
        'success-soft',
        'success-text',
        'success-border',
        'warn-soft',
        'warn-border',
        'warn-text',
        'danger-soft',
        'danger-text',
      ],
    },
  },
});

export { cn };

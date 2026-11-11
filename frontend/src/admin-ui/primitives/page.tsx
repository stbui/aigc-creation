import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { PageHeader } from './layout';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';

/**
 * 页签栏的统一实现。
 *
 * `payments` / `tasks` / `marketing-rules` 三页此前各自复制同一段
 * `TabsList h-9 gap-1 p-1` + `TabsTrigger h-7 px-3 text-sm font-medium`，
 * 任何一处想调高度或间距都要改三遍，且很容易只改对一处。
 *
 * 与 `SegmentedTabs` 的分工：
 *   - `SegmentedTabs` —— 只有标签、没有对应内容面板，纯筛选维度切换；
 *   - `AdminTabs`     —— 标签 + `TabsContent` 内容面板，每个标签是一块独立视图。
 *
 * 两者共用同一套尺寸（`h-9 / h-7 / px-3 / text-sm`），页面上看起来是同一个控件
 * 的两种用法，不会因为「有没有内容面板」而改变长相。
 */
export function AdminTabs({
  value,
  onValueChange,
  items,
  ariaLabel,
  className,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: ReadonlyArray<{ value: string; label: ReactNode }>;
  ariaLabel?: string;
  className?: string;
  /** `TabsContent` 列表。 */
  children: ReactNode;
}) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={cn('gap-3', className)}>
      <TabsList aria-label={ariaLabel} className="h-9 w-fit gap-1 p-1">
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            className="h-7 px-3 text-sm font-medium"
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}


/**
 * 后台页面统一骨架。
 *
 * ## 为什么需要这一层
 *
 * 31 个页面此前各自写外层容器，收敛出三种写法（`<>…</>`、`<div className="w-full">`、
 * `<div className="flex flex-col">`），页头与首个内容块的间距也随之在 16 / 28px 之间
 * 跳动；页签要么紧贴页头、要么自带 `gap-3`，一屏之内就能看出「这页不是同一个人写的」。
 *
 * 这里把「页面外框 + 页头 + 页签」三件事收成一处，间距由骨架决定，页面只声明
 * 内容。判定标准很简单：**同一层级的东西，在任何一页上下文的间距必须相同**。
 *
 * ## 间距口径
 *
 * - 页头 → 下一个块：12px（`mb-3`）。页头自带 `pb-4`，合计 28px。
 * - 页签 → 内容：由页签自身的 `gap` 承担，骨架不再叠加外边距。
 * - 内容块之间的间距由各块自带（`Panel` 的 `mb-4`、`FilterBar` 的 `mb-3`），
 *   骨架不用 `gap` —— 否则与块自带外边距叠加，页面上会出现 28px 与 12px 混排。
 *
 * ## 页头副标题
 *
 * 一律在标题**下方**。此前两页用 `inlineDescription` 把副标题挤到标题右侧，
 * 其余 29 页在下方；同一套后台里只保留一种，否则眼睛每换一页都要重新找说明。
 *
 * ## 骨架态
 *
 * 不在本组件里接管。首屏骨架的形态逐页不同（`storage` 只要 3 张卡、`membership-plans`
 * 要 8 张、`roles` 还带 notice），塞一个统一 `PageSkeleton` 只会让骨架与真实布局对不上。
 * 页面自持早退分支，用各页自己的 `<PageSkeleton …/>`。
 */
export function AdminPage({
  title,
  description,
  actions,
  tabs,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** 页头右侧动作区：刷新、导出、主操作按钮。 */
  actions?: ReactNode;
  /** 页签。由页面传入，骨架只负责位置与间距。 */
  tabs?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex w-full flex-col', className)}>
      <PageHeader title={title} description={description} actions={actions} className="mb-3" />
      {tabs && <div className="mb-3">{tabs}</div>}
      {children}
    </div>
  );
}

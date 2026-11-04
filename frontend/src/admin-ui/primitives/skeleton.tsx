import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import {
  Card,
  CardContent,
  CardHeader,
} from '../components/ui/card';
import { Skeleton as SkeletonBar } from '../components/ui/skeleton';
import { Tabs, TabsList } from '../components/ui/tabs';
import { PageHeader } from './layout';

/**
 * 后台页面级骨架件。
 *
 * ## 为什么不能整页塌成几根灰条
 *
 * 首屏加载时把标题、说明、动作区一起换成骨架，页面的**版面就消失了**：
 * 用户刷新一下看到的不是「正在加载」，而是「这页不见了」，回来时又是一片
 * 陌生的灰条。骨架该占住的是**位置**，不是把版面清空。
 *
 * 所以 `PageSkeleton` 的标题与说明**照常渲染真实文字** —— 用户始终知道自己在
 * 哪一页、这一页在管什么；只有**数据区**换成骨架。动作区也照常渲染（按钮在
 * 加载期间是 disabled 的，点不动但位置在）。
 *
 * ## 用 shadcn 原子件拼，不手写 div
 *
 * 面板骨架就是 `Card` + `CardHeader` + `CardContent`，指标卡骨架就是 `Card`，
 * 每一根占位条都是 shadcn 的 `Skeleton`。这样骨架与真实组件共用同一套
 * 边框、圆角、投影类名 —— 手写 `div` 的话，改了 `Panel` 的样式骨架不会跟着变，
 * 两边越走越远。
 *
 * ## 各种形态
 *
 * - `SkeletonPanel`：整块面板（标题占位 + 内容行），表单 / 列表页用；
 * - `SkeletonBody`：只替内容行，用在**真实面板已经渲染、只有里面在加载**时；
 * - `SkeletonStats`：统计卡一行（会员套餐、概览这类）；
 * - `SkeletonCards`：卡片网格（存储后端这类「一格一个后端」的布局）；
 * - `SkeletonTabs`：分段页签栏（设置页的分组页签）；
 * - `SkeletonDutyStrip`：概览首屏的值班条。
 *
 * 面板宽度与真实面板相同（`narrow` 限宽 760），数据到位时不会横向跳一下。
 */

/**
 * 页面骨架：真实页头 + 骨架正文。
 *
 * `data-testid="admin-page-loading"` 是 e2e 的加载判定锚点 ——
 * `tests/admin-ux.spec.ts` 靠它确认「加载结束」才量表格宽度。同名的锚点
 * 在 `AdminDataTable` 的表格骨架上也有一份，两者不会同时出现。
 *
 * ## 各区的对应关系
 *
 * | 参数 | 页面真实结构 |
 * | --- | --- |
 * | `title` / `description` / `actions` | 真实页头（`PageHeader`），**照常渲染文字** |
 * | `notice` | 页头与正文之间的固定提示条（`Notice`），**照常渲染** |
 * | `stats` | 顶部一行统计卡（`StatCard`） |
 * | `panels` | 正文面板（`Panel`），`narrow` 与真实面板同宽 |
 * | `cards` | 卡片网格（存储后端这类「一格一个」） |
 *
 * `notice` 只放**与数据无关**的固定提示（如「凭据不在界面配置」）。随数据
 * 出现 / 消失的提示（失败告警、过期位图）不要放进来 —— 那类提示在加载
 * 期间本来就无从知晓，强行占位反而是假的。
 *
 * `body` 是**逃生舱**：页面真实结构不是「统计卡 + 面板 + 卡片」这三段式
 * （概览页的双栏、值班条；设置页的分组页签）时，用它自己写骨架。
 * 用了 `body` 就不要再传 `stats` / `panels` / `cards` —— 两者同时渲染会多出
 * 一段假版面。
 *
 * `title` 可以不给 —— 用在**标签页内部**这种「页头已经在上面渲染好了」的
 * 场景：这时再插一个页头就是重复的标题。
 */
export function PageSkeleton({
  title,
  description,
  actions,
  notice,
  body,
  stats = 0,
  panels = 1,
  panelRows = 4,
  narrow = false,
  cards = 0,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** 页头与正文之间的固定提示条；照常渲染真实内容 */
  notice?: ReactNode;
  /** 自定义正文骨架；给了就接管 `stats` / `panels` / `cards` 三区 */
  body?: ReactNode;
  /** 统计卡数量；0 表示没有这一区 */
  stats?: number;
  /** 面板数量；0 表示没有这一区 */
  panels?: number;
  /** 每个面板内的内容行数 */
  panelRows?: number;
  /** 面板限宽 760（与窄版 `Panel` 一致） */
  narrow?: boolean;
  /** 卡片网格数量；0 表示没有这一区 */
  cards?: number;
}) {
  return (
    <div data-testid="admin-page-loading" aria-busy="true" aria-live="polite">
      {title !== undefined && (
        <PageHeader title={title} description={description} actions={actions} />
      )}
      {notice}
      {body ?? (
        <>
          {stats > 0 && <SkeletonStats count={stats} />}
          {cards > 0 && <SkeletonCards count={cards} />}
          {Array.from({ length: panels }).map((_, index) => (
            <SkeletonPanel key={index} rows={panelRows} narrow={narrow} />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * 面板骨架：一条标题占位 + 若干行内容占位。
 *
 * 结构与真实 `Panel` 同源（`Card` + `CardHeader` + `CardContent`），类名也
 * 跟着真实面板走 —— 改了 `Panel` 的边框或投影，这里自动跟上。
 */
export function SkeletonPanel({
  rows = 4,
  narrow = false,
  className,
}: {
  rows?: number;
  narrow?: boolean;
  className?: string;
}) {
  return (
    <Card
      style={narrow ? { maxWidth: 760 } : undefined}
      className={cn(
        'mb-4 gap-0 overflow-hidden rounded-lg border-border bg-card py-0 shadow-card',
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center gap-3 border-b border-border px-4 py-3 pb-3">
        <div className="min-w-0 flex-1">
          <SkeletonBar className="h-[13px] w-[180px]" />
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <SkeletonBody rows={rows} />
      </CardContent>
    </Card>
  );
}

/**
 * 内容行骨架：只替正文，面板外壳由真实 `Panel` 提供。
 *
 * 用在「面板已经渲染、里面这一块还在加载」的场景 —— 这时候外壳是实的，
 * 再套一层带边框的骨架就多了一道假边框。
 */
export function SkeletonBody({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <SkeletonBar
          key={index}
          className="h-9"
          style={{ animationDelay: `${index * 80}ms` }}
        />
      ))}
    </div>
  );
}

/**
 * 独立内容行骨架：自带加载语义。
 *
 * 页面级加载请用 `PageSkeleton`（它带 `data-testid="admin-page-loading"`）；
 * 这个是给「一小块内容在加载、没有整页骨架」的场景用的。
 */
export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-busy="true" aria-live="polite">
      <SkeletonBody rows={rows} />
    </div>
  );
}

/**
 * 统计卡骨架：标签 + 数字 + 提示三行，与 `StatCard` 的排布同构。
 */
export function SkeletonStats({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn(
        'mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]',
        className,
      )}
    >
      {Array.from({ length: count }).map((_, index) => (
        <Card
          key={index}
          className="min-h-[92px] w-full justify-center gap-0 rounded-lg border-border bg-card px-4 py-3 shadow-card"
        >
          <SkeletonBar className="h-3 w-16" />
          <SkeletonBar className="mt-2 h-6 w-20" />
          <SkeletonBar className="mt-1.5 h-3 w-28" />
        </Card>
      ))}
    </div>
  );
}

/**
 * 分段页签骨架：与 `SegmentedTabs` 同构（`TabsList` + 一排胶囊占位）。
 *
 * 页签的**选项**来自接口，加载期没有 —— 但整条页签栏的位置得占住，
 * 否则下面那块面板会往上跳一截。胶囊数量按常见的 3～4 组给。
 */
export function SkeletonTabs({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    /*
     * 必须包在 `Tabs` 里：`TabsList` 的高度靠父级的 `group-data-[orientation=…]`
     * 变体类算出来，没有根节点就只有一条 3px 的空壳。
     */
    <Tabs className="gap-0">
      <TabsList aria-hidden className={cn('mb-4 h-9 gap-1 p-1', className)}>
        {Array.from({ length: count }).map((_, index) => (
          <SkeletonBar key={index} className="h-7 w-24 rounded-md" />
        ))}
      </TabsList>
    </Tabs>
  );
}

/**
 * 值班条骨架：概览首屏那条「机器刚才在不在转」的读数条。
 *
 * 真实版面是「标题行 + 刻度条 + 四个计数」，这里只占住整条的高度 ——
 * 刻度与计数都是数据驱动的，加载期没有意义的近似值。
 */
export function SkeletonDutyStrip({ className }: { className?: string }) {
  return (
    <Card
      className={cn(
        'mb-4 gap-0 overflow-hidden rounded-lg border-border bg-card py-0 shadow-card',
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <SkeletonBar className="h-[13px] w-24" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:gap-6">
        <div className="min-w-0 flex-1">
          <SkeletonBar className="h-8 w-full" />
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="flex flex-col justify-center rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
            >
              <SkeletonBar className="h-3 w-12" />
              <SkeletonBar className="mt-1.5 h-4 w-8" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * 卡片网格骨架：与「一格一个后端」这类卡片列表同构（auto-fit，最小 300px）。
 */
export function SkeletonCards({
  count = 3,
  className,
  gridClassName,
}: {
  count?: number;
  className?: string;
  gridClassName?: string;
}) {
  return (
    <div
      className={cn(
        'mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]',
        gridClassName,
        className,
      )}
    >
      {Array.from({ length: count }).map((_, index) => (
        <Card
          key={index}
          className="gap-0 rounded-lg border-border bg-card p-4 shadow-card"
        >
          <SkeletonBar className="h-4 w-24" />
          <SkeletonBar className="mt-3 h-3 w-full" />
          <SkeletonBar className="mt-2 h-3 w-3/4" />
          <SkeletonBar className="mt-4 h-8 w-28" />
        </Card>
      ))}
    </div>
  );
}

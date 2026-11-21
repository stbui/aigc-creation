/**
 * 营销首页的外部控件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `landing/` 下的文件不从 `src/components` / `src/admin-ui` 直接取东西,
 * 一律经由本文件。目录内新增共享控件引用时在这里补一行 re-export。
 *
 * 第三方 UI 库 (lucide-react) 不经本文件 —— 它们不是本项目的共享控件。
 */

/**
 * shadcn 组合件：C 端营销页只从 `~/ui` 取件，不直连原子层。
 *
 * - `Button` / `TextAction`：首屏与套餐 CTA、卡片内「做同款」文字动作
 * - `DropdownMenu`：顶导能力分组下拉（替代手写 hover 菜单）
 * - `Sheet`：≤900px 导航抽屉（替代手写 scrim + 滑入面板）
 * - `Tabs`：套餐三个页签（页面里是内容面板切换，用页签语义而不是过滤条）
 * - `Surface`：场景卡 / 套餐卡 / 特性卡
 * - `Badge`：能力数徽标、推荐角标、限时价角标、悬停浮出的「做同款」
 * - `AspectRatio`：案例卡的 3:4 画幅
 */
export {
  AspectRatio,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Surface,
  SurfaceContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextAction,
} from '../../ui';
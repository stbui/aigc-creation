/**
 * 浮层（抽屉 / 弹窗 / 确认框）的公共皮肤。
 *
 * 四个浮层此前各抄一份「12px 圆角 + 1px radar-ink-200 描边 + 零阴影 + 15px 标题」
 * 的类名，改一处尺寸就漏一处。现在只在这里维护一份，各浮层按需拼接：
 *
 *   - `OVERLAY_BACKDROP` → 传给 shadcn 原语的 `overlayClassName`；
 *   - `OVERLAY_SURFACE`  → 内容壳的底色 / 描边 / 内边距，尺寸与定位由调用方补；
 *   - `OVERLAY_HEADER` / `OVERLAY_TITLE` / `OVERLAY_DESC` / `OVERLAY_CLOSE`
 *     → 头部四件套，语义标签仍由各浮层自己决定（SheetTitle / DialogTitle …）；
 *   - `OVERLAY_FOOTER`   → 底部按钮条。
 */

/** 遮罩：25% 墨黑 + 1px 模糊，入场动画走 radar-backdrop-enter。 */
export const OVERLAY_BACKDROP =
  'radar-backdrop-enter bg-radar-ink-950/25 backdrop-blur-[1px]';

/** 内容壳：白底、细线、12px 圆角、零阴影。不含 border，抽屉只保留左边线。 */
export const OVERLAY_SURFACE =
  'admin-portal radar-scope flex flex-col gap-0 overflow-hidden bg-radar-surface p-0 shadow-none outline-none';

export const OVERLAY_HEADER =
  'flex shrink-0 items-start justify-between gap-3 border-b border-radar-ink-100';

export const OVERLAY_TITLE = 'truncate text-[15px] font-semibold text-radar-ink-950';

export const OVERLAY_DESC = 'mt-0.5 text-pretty text-[12.5px] leading-5 text-radar-ink-400';

export const OVERLAY_CLOSE =
  'shrink-0 rounded-lg p-1.5 text-radar-ink-500 transition-colors hover:bg-radar-ink-100 hover:text-radar-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-radar-accent';

export const OVERLAY_FOOTER =
  'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-radar-ink-100 bg-radar-surface-hover px-5 py-3';

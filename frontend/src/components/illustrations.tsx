/**
 * 全站状态插画 —— 唯一的插画定义地。
 *
 * 2026-10-20 抽取。此前插画散在两处且互相循环依赖:
 *   - `ToolShell.tsx` 导出 `ToolEmptyIllustration`, 而 `ToolEmptyState.tsx`
 *     又从 `ToolShell` import 它 → **ToolEmptyState ↔ ToolShell 成环**。
 *     ESM 靠提升侥幸能跑, 但任何一侧改成运行时求值就会炸。
 *   - `ExceptionPage.tsx` 内联一份 `Illustration`, 自成一套构图。
 *     两份插画都是"圆角方框 + 品牌紫点缀"的同一套设计语言, 却各画各的。
 *
 * 本文件是插画的唯一归属地, 两个组件都从这里取, 环随之消失。
 *
 * 两版插画并存是**刻意**的, 不是重复:
 *   - `ToolEmptyIllustration` —— 「这里该有一张图」, 工具结果栏 / 素材库空态用。
 *     构图含山峦与加号徽标, 语义是"放图片的地方, 现在空着"。
 *   - `StateIllustration`      —— 「这块内容没渲染出来」, 异常页 / 错误态用。
 *     构图是三条内容块, 按 kind 换徽标符号。
 *   两者都从"圆角方框 + 品牌紫圆徽标"这一母题派生, 属同一设计语言。
 */

/**
 * 工具页 / 素材库空态插画。
 *
 * 160×160, 与参考站空态占位图同尺寸 (参考站为位图, 本地不引第三方图片资源,
 * 改用内联 SVG, 同 AuthCard / HeroArt 的纪律)。
 *
 * 色值全部走 var(--token): 此前此图内联 7 处裸 hex (#F1EFFF / #E4E7EF /
 * #C7D2FE / #A5B4FC / #5546D8 / #8064F6), 违反 CLAUDE.md「不写裸 hex」。
 * 其中两个淡紫没有语义等价 token, 新增 --illus-sun / --illus-mountain 专供插画,
 * 字面值与原图一致 —— **换 token 不改视觉**, 只让色值可被审计。
 */
export function ToolEmptyIllustration() {
  return (
    <svg className="pk-empty-illustration" width="160" height="160" viewBox="0 0 160 160" fill="none" aria-hidden>
      <rect x="18" y="30" width="112" height="96" rx="12" fill="var(--brand-bg)" />
      <rect x="30" y="42" width="88" height="72" rx="8" fill="var(--card-bg)" stroke="var(--border-soft)" />
      <circle cx="58" cy="66" r="8" fill="var(--illus-sun)" />
      <path d="M40 106 L66 78 L86 100 L100 86 L118 106 V110 H40 Z" fill="var(--illus-mountain)" opacity="0.85" />
      <circle cx="118" cy="46" r="16" fill="var(--brand)" />
      <path d="M118 39 v14 M111 46 h14" stroke="var(--card-bg)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="34" cy="38" r="2.5" fill="var(--brand-light)" />
      <circle cx="126" cy="112" r="2.5" fill="var(--brand-light)" />
      <circle cx="24" cy="86" r="2" fill="var(--brand-light)" />
    </svg>
  );
}

/** 状态语义。决定插画徽标配色与符号, 不决定业务文案 (业务文案由调用方传入)。 */
export type StateKind = 'error' | 'warning' | 'info' | 'not-found' | 'empty';

/**
 * 通用状态插画 —— 异常页 / 错误态 / 通用空态用。
 *
 * 与 `ToolEmptyIllustration` 同母题 (圆角方框 + 品牌紫圆徽标), 差别在框内内容:
 * 这里是三条内容块, 表达「这块内容没渲染出来」。
 */
export function StateIllustration({ kind = 'empty', size = 160 }: { kind?: StateKind; size?: number }) {
  const markFill =
    kind === 'error'
      ? 'var(--danger-soft-text)'
      : kind === 'warning'
        ? 'var(--accent-amber)'
        : 'var(--brand)';

  return (
    <svg
      className="exc-illustration"
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      aria-hidden
    >
      <rect x="18" y="30" width="112" height="96" rx="12" fill="var(--brand-bg)" />
      <rect x="30" y="42" width="88" height="72" rx="8" fill="var(--card-bg)" stroke="var(--border)" />
      {/* 内容块: 表达「这块内容没渲染出来」 */}
      <rect x="44" y="58" width="46" height="7" rx="3.5" fill="var(--border-row)" />
      <rect x="44" y="72" width="60" height="7" rx="3.5" fill="var(--border-row)" />
      <rect x="44" y="86" width="34" height="7" rx="3.5" fill="var(--border-row)" />
      {/* 徽标圆: 按 kind 换色, 承载状态符号 */}
      <circle cx="116" cy="46" r="17" fill={markFill} />
      {kind === 'error' && (
        <path d="M110 40 l12 12 M122 40 l-12 12" stroke="var(--card-bg)" strokeWidth="2.6" strokeLinecap="round" />
      )}
      {kind === 'warning' && (
        <path d="M116 38 v10 M116 52.5 v1.5" stroke="var(--card-bg)" strokeWidth="2.6" strokeLinecap="round" />
      )}
      {(kind === 'info' || kind === 'not-found' || kind === 'empty') && (
        <path d="M116 39 v14 M109 46 h14" stroke="var(--card-bg)" strokeWidth="2.6" strokeLinecap="round" />
      )}
      <circle cx="34" cy="38" r="2.5" fill="var(--brand-light)" />
      <circle cx="126" cy="112" r="2.5" fill="var(--brand-light)" />
      <circle cx="24" cy="86" r="2" fill="var(--brand-light)" />
    </svg>
  );
}

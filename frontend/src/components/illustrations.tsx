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

/** 局部重绘: 卡面里的虚线选区 + 画笔, 表达「圈出局部再涂抹」 */
export function LocalRedrawIllustration() {
  return (
    <svg className="pk-empty-illustration" width="160" height="160" viewBox="0 0 160 160" fill="none" aria-hidden>
      <rect x="18" y="30" width="112" height="96" rx="12" fill="var(--brand-bg)" />
      <rect x="30" y="42" width="88" height="72" rx="8" fill="var(--card-bg)" stroke="var(--border-soft)" />
      <circle cx="52" cy="64" r="6" fill="var(--illus-sun)" />
      <path d="M38 104 L60 78 L76 96 L90 84 L110 104 V108 H38 Z" fill="var(--illus-mountain)" opacity="0.85" />
      <ellipse
        cx="73"
        cy="87"
        rx="26"
        ry="17"
        fill="none"
        stroke="var(--brand-light)"
        strokeWidth="1.8"
        strokeDasharray="4 3"
      />
      <path d="M96 72 L113 55" stroke="var(--brand)" strokeWidth="4" strokeLinecap="round" opacity="0.65" />
      <path d="M111 51 l6 6 -10 10 -7 1 1 -7 Z" fill="var(--brand)" />
      <circle cx="118" cy="46" r="16" fill="var(--brand)" />
      <path d="M111 53 l7 -7 M116 45 l4 4" stroke="var(--card-bg)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="34" cy="38" r="2.5" fill="var(--brand-light)" />
      <circle cx="126" cy="112" r="2.5" fill="var(--brand-light)" />
      <circle cx="24" cy="86" r="2" fill="var(--brand-light)" />
    </svg>
  );
}

/* ───────── 修图系工具页专属空态插画 ─────────
 * 与 ToolEmptyIllustration 同一母题 (圆角方框 + 品牌紫圆徽标), 但每个工具
 * 在卡面里画自己的业务符号 —— 四个修图页此前共用一张通用图, 用户在
 * 去水印/翻译/扩图/精修之间切换时右侧看起来像没换页。逐页区分后,
 * 空态本身就在说「这是哪个工具」, 不必读标题。
 * 全部走 var(--token), 不写裸 hex (同 ToolEmptyIllustration 纪律)。
 */

/** 去除水印: 卡面右下有虚线选区 + 水滴, 徽标是水滴被斜线划掉 */
export function RemoveWatermarkIllustration() {
  return (
    <svg className="pk-empty-illustration" width="160" height="160" viewBox="0 0 160 160" fill="none" aria-hidden>
      <rect x="18" y="30" width="112" height="96" rx="12" fill="var(--brand-bg)" />
      <rect x="30" y="42" width="88" height="72" rx="8" fill="var(--card-bg)" stroke="var(--border-soft)" />
      <circle cx="52" cy="62" r="7" fill="var(--illus-sun)" />
      <path d="M36 102 L60 76 L78 96 L92 84 L110 102 V106 H36 Z" fill="var(--illus-mountain)" opacity="0.85" />
      <rect x="84" y="86" width="26" height="15" rx="3" fill="none" stroke="var(--brand-light)" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M97 88.5 c2.4 3 3.8 5 3.8 6.8 a3.8 3.8 0 1 1 -7.6 0 c0 -1.8 1.4 -3.8 3.8 -6.8 Z" fill="var(--illus-sun)" opacity="0.7" />
      <circle cx="118" cy="46" r="16" fill="var(--brand)" />
      <path d="M118 38 c3 4 5 6.5 5 9 a5 5 0 1 1 -10 0 c0 -2.5 2 -5 5 -9 Z" fill="var(--card-bg)" />
      <path d="M111 53 L125 39" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="34" cy="38" r="2.5" fill="var(--brand-light)" />
      <circle cx="126" cy="112" r="2.5" fill="var(--brand-light)" />
      <circle cx="24" cy="86" r="2" fill="var(--brand-light)" />
    </svg>
  );
}

/** 图片翻译: 卡面是「文 → A」两只气泡, 徽标是双向箭头 */
export function ImageTranslateIllustration() {
  return (
    <svg className="pk-empty-illustration" width="160" height="160" viewBox="0 0 160 160" fill="none" aria-hidden>
      <rect x="18" y="30" width="112" height="96" rx="12" fill="var(--brand-bg)" />
      <rect x="30" y="42" width="88" height="72" rx="8" fill="var(--card-bg)" stroke="var(--border-soft)" />
      <rect x="40" y="62" width="30" height="24" rx="6" fill="var(--brand-bg)" />
      <text x="55" y="74" textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="700" fill="var(--brand)" fontFamily="inherit">文</text>
      <rect x="88" y="62" width="30" height="24" rx="6" fill="var(--brand)" />
      <text x="103" y="74" textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="700" fill="var(--card-bg)" fontFamily="inherit">A</text>
      <path d="M74 74 h10 M81 71 l3 3 -3 3" stroke="var(--brand-light)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M40 98 h34 M46 94 l-6 4 6 4" stroke="var(--border-row)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M84 98 h34 M108 94 l6 4 -6 4" stroke="var(--border-row)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="118" cy="46" r="16" fill="var(--brand)" />
      <path d="M112 42 h10 M119 39 l3 3 -3 3" stroke="var(--card-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M124 50 h-10 M117 47 l-3 3 3 3" stroke="var(--card-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="34" cy="38" r="2.5" fill="var(--brand-light)" />
      <circle cx="126" cy="112" r="2.5" fill="var(--brand-light)" />
      <circle cx="24" cy="86" r="2" fill="var(--brand-light)" />
    </svg>
  );
}

/** 智能扩图: 卡片偏小 + 四角向外箭头, 徽标是斜向扩张 */
export function ExpandIllustration() {
  return (
    <svg className="pk-empty-illustration" width="160" height="160" viewBox="0 0 160 160" fill="none" aria-hidden>
      <rect x="18" y="30" width="112" height="96" rx="12" fill="var(--brand-bg)" />
      <rect x="46" y="58" width="56" height="44" rx="8" fill="var(--card-bg)" stroke="var(--border-soft)" />
      <circle cx="60" cy="70" r="5" fill="var(--illus-sun)" />
      <path d="M50 96 L64 82 L76 94 L84 88 L96 96 V98 H50 Z" fill="var(--illus-mountain)" opacity="0.85" />
      <path d="M42 54 L31 43 M31 43 h7 M31 43 v7" stroke="var(--brand-light)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M106 54 L117 43 M117 43 h-7 M117 43 v7" stroke="var(--brand-light)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M42 106 L31 117 M31 117 h7 M31 117 v-7" stroke="var(--brand-light)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M106 106 L117 117 M117 117 h-7 M117 117 v-7" stroke="var(--brand-light)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="118" cy="46" r="16" fill="var(--brand)" />
      <path d="M119 47 L111 39 M111 39 h5 M111 39 v5" stroke="var(--card-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M117 45 L125 53 M125 53 h-5 M125 53 v-5" stroke="var(--card-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="34" cy="38" r="2.5" fill="var(--brand-light)" />
      <circle cx="126" cy="112" r="2.5" fill="var(--brand-light)" />
      <circle cx="24" cy="86" r="2" fill="var(--brand-light)" />
    </svg>
  );
}

/** 产品精修: 卡面带山峦 + 星芒点缀, 徽标是一颗四角星 */
export function EnhanceIllustration() {
  return (
    <svg className="pk-empty-illustration" width="160" height="160" viewBox="0 0 160 160" fill="none" aria-hidden>
      <rect x="18" y="30" width="112" height="96" rx="12" fill="var(--brand-bg)" />
      <rect x="30" y="42" width="88" height="72" rx="8" fill="var(--card-bg)" stroke="var(--border-soft)" />
      <circle cx="48" cy="64" r="6" fill="var(--illus-sun)" />
      <path d="M36 104 L58 80 L74 96 L88 86 L108 104 V108 H36 Z" fill="var(--illus-mountain)" opacity="0.85" />
      <path d="M96 50 l1.6 3.8 3.8 1.6 -3.8 1.6 -1.6 3.8 -1.6 -3.8 -3.8 -1.6 3.8 -1.6 Z" fill="var(--brand-light)" />
      <path d="M106 62 l1.1 2.6 2.6 1.1 -2.6 1.1 -1.1 2.6 -1.1 -2.6 -2.6 -1.1 2.6 -1.1 Z" fill="var(--illus-sun)" />
      <path d="M88 42 l0.9 2.1 2.1 0.9 -2.1 0.9 -0.9 2.1 -0.9 -2.1 -2.1 -0.9 2.1 -0.9 Z" fill="var(--brand-light)" />
      <circle cx="118" cy="46" r="16" fill="var(--brand)" />
      <path d="M118 36 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4 Z" fill="var(--card-bg)" />
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

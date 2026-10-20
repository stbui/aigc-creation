import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { StateIllustration, type StateKind } from './illustrations';

/**
 * 全站统一状态组件。
 *
 * 2026-10-20 抽取。此前「加载中 / 空 / 失败」三种态在 20+ 个页面各写一遍,
 * 且实现分裂成四套互不相容的写法:
 *
 *   ① antd `<Empty>`  —— WorkbenchPage / StatsPage / ToolPage / AdminWidgets,
 *      用的是 antd 默认灰蓝插画, 与站内自绘的品牌紫插画不是同一套设计语言
 *      (ExceptionPage 抽取时已认定该问题, 但只修了异常页, 普通空态没修)。
 *   ② antd `<Spin>`   —— App.tsx / StatsPage / ToolPage / AdminWidgets。
 *   ③ lucide `Loader2` + 自定义 CSS 动画 —— WorksPage / LibraryPage / PackagesPage。
 *   ④ 纯文本          —— CreditsPage「正在加载…」、InvitationsPage「加载中…」
 *      直接拿 h2/p 充当加载指示器。
 *
 * 四套并行的代价不是"不好看", 而是**行为不一致**:
 *   - 只有 antd Empty 一套能撑住"失败"语义, 于是「加载失败」被大量页面
 *     直接渲染成 antd Empty 或纯文本, 用户分不清"没数据"还是"没连上";
 *   - 加载态只有 §④ 那两处是纯文本, 慢网下用户以为页面是空的。
 *
 * 本组件收敛为一套: 骨架屏(占位防跳动) + 空态 + 失败态 + 行内加载,
 * 插画统一走 illustrations.tsx, 色值全部 var(--token)。
 */

/* ────────────────────────── 骨架屏 ────────────────────────── */

/**
 * 骨架屏 —— 加载期的占位。
 *
 * 为什么不用转圈: 转圈会让内容区域高度塌陷再撑开, 页面明显跳动;
 * 骨架屏占住最终布局的形状, 内容到达时零位移。
 *
 * `variant` 决定占位形状, 与目标内容对应:
 *   - `card`  卡片网格 (作品页 / 素材库)
 *   - `row`   列表行 (积分流水 / 订单)
 *   - `panel` 面板块 (工作台数据面板)
 *   - `block` 单个大块 (整页加载)
 */
export function StateSkeleton({
  variant = 'card',
  count = 6,
  columns,
}: {
  variant?: 'card' | 'row' | 'panel' | 'block';
  count?: number;
  /** card 变体的列数; 不传则由 CSS 决定 */
  columns?: number;
}) {
  return (
    <div
      className={`state-skeleton is-${variant}`}
      style={columns ? ({ ['--skeleton-columns' as string]: columns } as React.CSSProperties) : undefined}
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="state-skeleton-item">
          {variant === 'card' && <span className="state-skeleton-thumb" />}
          {variant === 'panel' && <span className="state-skeleton-line is-wide" />}
          {variant !== 'block' && <span className="state-skeleton-line" />}
          {variant !== 'block' && <span className="state-skeleton-line is-short" />}
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────── 行内加载 ────────────────────────── */

/**
 * 行内加载指示器 —— 替代裸 `<Spin>` 与「正在加载…」纯文本。
 *
 * `full` 撑满可视区 (整页加载), 否则作为块内居中 (面板 / 弹窗内加载)。
 * 文案默认必显: 纯图形转圈用户无法判断是"在加载"还是"卡住了"。
 */
export function StateLoading({
  tip = '加载中…',
  full = false,
  size = 'default',
}: {
  tip?: string;
  /** 撑满可视区, 用于整页/路由级加载 */
  full?: boolean;
  size?: 'small' | 'default';
}) {
  return (
    <div className={`state-loading${full ? ' is-full' : ''}`} role="status" aria-live="polite">
      <span className={`state-spinner${size === 'small' ? ' is-small' : ''}`} aria-hidden />
      <span className="state-loading-tip">{tip}</span>
    </div>
  );
}

/* ────────────────────────── 空态 ────────────────────────── */

/**
 * 通用空态。
 *
 * 三个空态必须分清, 否则用户无法判断该做什么:
 *   - **没有数据**   → `title` 说清"这里本该有什么", `desc` 给下一步
 *   - **筛选无结果** → title 改成"没有符合条件的结果", desc 引导放宽条件
 *   - **还没做过**   → 给一个主动作按钮 (去创建 / 去上传)
 *
 * `action` 传节点 (通常是 <button>), 组件不关心它的具体行为。
 */
export function StateEmpty({
  title,
  desc,
  action,
  kind = 'empty',
  compact = false,
}: {
  title: string;
  desc?: string;
  /** 主动作 (按钮 / 链接) */
  action?: ReactNode;
  kind?: StateKind;
  /** 紧凑模式: 去掉插画, 用于弹窗 / 小卡片内 */
  compact?: boolean;
}) {
  return (
    <div className={`state-empty${compact ? ' is-compact' : ''}`}>
      {!compact && <StateIllustration kind={kind} />}
      <p className="state-empty-title">{title}</p>
      {desc && <p className="state-empty-desc">{desc}</p>}
      {action && <div className="state-empty-action">{action}</div>}
    </div>
  );
}

/* ────────────────────────── 失败态 ────────────────────────── */

/**
 * 通用失败态 —— 「没连上」与「没数据」是两件事, 必须分开呈现。
 *
 * 此前多数页面把加载失败直接渲染成空态 (作品页 / 素材库页: 弹个 message
 * 就走空态分支), 用户看到的是"你还没有作品", 而真相是"接口没连上"。
 * 这是**谎报状态**, 会让用户以为数据丢了而反复重试。
 *
 * 失败态必须给三样东西: 说清发生了什么 / 可展开的技术细节 / 一个重试出口。
 */
export function StateError({
  title = '加载失败',
  desc,
  detail,
  onRetry,
  action,
  compact = false,
}: {
  title?: string;
  desc?: string;
  /** 技术细节原文 (错误信息 / 状态码), 如实展示 */
  detail?: string;
  /** 重试回调; 不传则不渲染重试按钮 */
  onRetry?: () => void;
  /** 附加操作 (如「返回商城」), 渲染在重试按钮之后 */
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`state-error${compact ? ' is-compact' : ''}`} role="alert">
      {!compact && <StateIllustration kind="error" />}
      <p className="state-error-title">{title}</p>
      {desc && <p className="state-error-desc">{desc}</p>}
      {detail && <p className="state-error-detail">{detail}</p>}
      {(onRetry || action) && (
        <div className="state-error-action">
          {onRetry && (
            <button type="button" className="state-btn is-primary" onClick={onRetry}>
              <RotateCcw size={14} />
              重试
            </button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

/** 状态态按钮 —— 与 .exc-btn 同一套视觉 (圆角/字号/主色态) */
export function StateButton({
  children,
  onClick,
  variant = 'primary',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`state-btn${variant === 'primary' ? ' is-primary' : ' is-ghost'}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

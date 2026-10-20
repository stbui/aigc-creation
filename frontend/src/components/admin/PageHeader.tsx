import * as React from 'react';
import type { ReactNode } from 'react';

/** 页头: 标题 + 描述 + 操作区 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="adm-page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="adm-page-head-actions">{actions}</div>}
    </div>
  );
}

/** 筛选条容器 */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="adm-filter">{children}</div>;
}

/** 筛选条右侧的查询/重置按钮组 */
export function FilterActions({ children }: { children: ReactNode }) {
  return <div className="adm-filter-actions">{children}</div>;
}

/** 统计卡 */
export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** 异常态: 余额为负、超阈值等 */
  tone?: 'danger' | 'warn';
}) {
  return (
    <div className={`adm-stat${tone ? ` is-${tone}` : ''}`}>
      <div className="adm-stat-label">{label}</div>
      <div className="adm-stat-value">{value}</div>
      {hint && <div className="adm-stat-hint">{hint}</div>}
    </div>
  );
}

/** 面板容器 */
export function Panel({
  title,
  note,
  extra,
  isNarrow = false,
  children,
}: {
  title?: string;
  note?: string;
  extra?: ReactNode;
  /** 窄版: 表单型页面限制内容宽度, 避免视线横跨半个屏幕 */
  isNarrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`adm-panel${isNarrow ? ' is-narrow' : ''}`}>
      {title && (
        <div className="adm-panel-title">
          {title}
          {note && <span className="adm-panel-note">{note}</span>}
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * 可折叠面板 (2026-10-20)。
 *
 * ## 为什么需要
 *
 * 模型配置页有 53 个配置项平铺在 4 个面板里, 其中「超时与轮询」9 项
 * 是**低频**参数 (绝大多数情况用默认值即可) —— 但它们与「基址/令牌/模型」
 * 这类必填项视觉权重完全相同, 于是必填项被淹没。
 *
 * 抄 New API 的做法: 高级项默认折叠, 必填项保持展开。
 *
 * ## 折叠状态要能记住
 *
 * 运营可能需要经常调超时 (排查轮询超时时), 每次都要重新展开很烦。
 * 故把展开状态提到调用方 (页面), 由页面决定要不要持久化。
 */
export function CollapsiblePanel({
  title,
  note,
  extra,
  defaultOpen = false,
  open,
  onToggle,
  /** 折叠时显示的摘要 (如「9 项, 全部为默认值」) */
  collapsedHint,
  children,
}: {
  title?: string;
  note?: string;
  extra?: ReactNode;
  /** 初始展开状态 (不受控时用) */
  defaultOpen?: boolean;
  /** 受控的展开状态 (受控时优先) */
  open?: boolean;
  /** 展开状态变化回调 (受控时必给) */
  onToggle?: (next: boolean) => void;
  /** 折叠时在标题右侧显示的提示 */
  collapsedHint?: ReactNode;
  children: ReactNode;
}) {
  const [inner, setInner] = React.useState(defaultOpen);
  const isOpen = open ?? inner;
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setInner(next);
    onToggle?.(next);
  };

  return (
    <div className={`adm-panel adm-panel-collapsible${isOpen ? ' is-open' : ''}`}>
      {(title || extra) && (
        <button
          type="button"
          className="adm-panel-title adm-panel-title-btn"
          onClick={toggle}
          aria-expanded={isOpen}
        >
          <span className="adm-panel-caret" aria-hidden="true">
            {isOpen ? '▾' : '▸'}
          </span>
          {title}
          {note && <span className="adm-panel-note">{note}</span>}
          {extra}
          {!isOpen && collapsedHint && (
            <span className="adm-panel-collapsed-hint">{collapsedHint}</span>
          )}
        </button>
      )}
      {isOpen && children}
    </div>
  );
}

/** 空态: 说明原因 + 可选行动, 不留空白 */
export function AdminEmpty({
  description,
  action,
}: {
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="adm-empty">
      <p>{description}</p>
      {action}
    </div>
  );
}

/**
 * 状态标签。
 *
 * 双编码: 色块 + 中文文字 —— 只靠颜色对色觉障碍用户不可读,
 * 只靠颜色也让扫视效率低下。
 *
 * ⚠ 早期版本直接把英文原值(succeeded/failed)透出, 在中文后台里非常刺眼,
 * 运营需要逐字翻译才能理解。这里统一映射为中文;
 * 未登记的状态回退到原值而不是隐藏 —— 隐藏会让"未知状态"看起来像"正常"。
 */
const STATUS_META: Record<string, { label: string; tone: TagTone }> = {
  // 任务状态 (后端 Prisma GenerationTask.status)
  succeeded: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  running: { label: '进行中', tone: 'brand' },
  pending: { label: '等待', tone: 'warn' },
  cancelled: { label: '已取消', tone: 'muted' },
  // 账号状态 (后端 Prisma User.status)
  active: { label: '正常', tone: 'success' },
  disabled: { label: '已禁用', tone: 'warn' },
  deleted: { label: '已注销', tone: 'muted' },
  // 角色
  user: { label: '用户', tone: 'muted' },
  admin: { label: '管理员', tone: 'brand' },
  operator: { label: '运营', tone: 'success' },
  finance: { label: '财务', tone: 'success' },
};

export type TagTone = 'success' | 'danger' | 'warn' | 'brand' | 'muted';

export function StatusTag({ status }: { status: string }) {
  const item = STATUS_META[status] ?? { label: status, tone: 'muted' as TagTone };
  return (
    <span className={`adm-tag is-${item.tone}`}>
      <span className="adm-tag-dot" aria-hidden="true" />
      {item.label}
    </span>
  );
}
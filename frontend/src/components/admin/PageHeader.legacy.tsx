import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Collapse, Empty, Flex, Space, Tag } from 'antd';
import { STATUS_META, type TagTone } from './statusMeta';

/** 状态语义色 → .adm-tag 的修饰类（底色与文字色都来自 global.css 的令牌） */
const TONE_CLASS: Record<TagTone, string> = {
  success: 'is-success',
  danger: 'is-danger',
  warn: 'is-warn',
  brand: 'is-brand',
  muted: 'is-muted',
};

/**
 * 栏目线（原三行页头）。
 *
 * ## 删掉了什么
 *
 * 面包屑「运营后台 / 分组 / 页面」：左栏已经标出当前位置，再写一遍只是
 * 在首屏占掉一行；页头说明段：页面用途一句话足够，长说明移到标题的
 * 悬停提示里，需要时看，不需要时不占首屏。
 *
 * 留下来的只有三样：标题、一行说明、右侧动作。整行 40px，压在内容上方
 * 一条发丝线下 —— 它是分隔线，不是一块页头装饰。
 *
 * `description` 保持字符串入参：29 个页面都传的是纯文本，这里不做
 * ReactNode 兼容，改文案不会牵出布局差异。
 */
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
    <header className="adm-page-head">
      <div className="adm-page-head-main">
        <h1 className="adm-page-head-title">{title}</h1>
        {description && (
          <p className="adm-page-head-note" title={description}>
            {description}
          </p>
        )}
      </div>
      {actions && (
        <Space className="adm-page-head-actions" size={8}>
          {actions}
        </Space>
      )}
    </header>
  );
}

/**
 * 筛选条容器。
 *
 * 默认是自动换行的 flex：控件少的页面一行放得下，多的页面自然换行。
 * `className="is-grid"` 换成等宽网格（2 行 × 4 列），用于控件多到换行后
 * 只剩一个控件、右侧又吊着查询按钮的页面 —— 那种断行的空白比控件本身更显眼。
 */
export function FilterBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Flex className={`adm-filter${className ? ` ${className}` : ''}`} align="center" gap={8} wrap="wrap">
      {children}
    </Flex>
  );
}

/** 筛选条右侧的查询/重置按钮组 */
export function FilterActions({ children }: { children: ReactNode }) {
  return (
    <Space className="adm-filter-actions" size={8}>
      {children}
    </Space>
  );
}

/** 一条已生效的筛选条件。`onClear` 为空时只展示，不提供单独清除。 */
export interface AppliedFilter {
  key: string;
  label: string;
  onClear?: () => void;
}

/**
 * 已生效筛选回显。
 *
 * 与筛选栏里的草稿值分开：用户改了输入框但没有点「查询」时，这里仍显示
 * 当前列表真正使用的条件。每条带单独清除，避免为了去掉一个条件整页重置。
 */
export function AppliedFilters({
  items,
  onClearAll,
}: {
  items: AppliedFilter[];
  onClearAll?: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="adm-filter-chips" aria-label="已生效的筛选条件">
      <span className="adm-filter-chips-label">已筛选</span>
      {items.map((item) => (
        <Tag
          key={item.key}
          className="adm-filter-chip"
          closable={Boolean(item.onClear)}
          onClose={(event) => {
            event.preventDefault();
            item.onClear?.();
          }}
          title={item.label}
        >
          {item.label}
        </Tag>
      ))}
      {onClearAll && (
        <Button type="link" className="adm-filter-chip-clear" onClick={onClearAll}>
          全部清除
        </Button>
      )}
    </div>
  );
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
    <Card
      className={`adm-stat${tone ? ` is-${tone}` : ''}`}
      style={{ padding: 0 }}
      styles={{
        body: {
          padding: '16px 18px',
          minHeight: 96,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        },
      }}
    >
      <div className="adm-stat-label">{label}</div>
      <div className="adm-stat-value">{value}</div>
      {hint && <div className="adm-stat-hint">{hint}</div>}
    </Card>
  );
}

/**
 * 区块容器。
 *
 * 2026-10-29：从 antd Card 换成裸 section —— 后台不使用卡片容器与投影，
 * 区块之间靠栏目线、发丝线与留白分区。类名保持不变，页面无需改动。
 */
export function Panel({
  title,
  note,
  extra,
  isNarrow = false,
  children,
}: {
  // 用 ReactNode 而不是 string：BoardUI 版支持节点，两版签名必须一致，
  // 否则入口文件里的联合类型无法直接渲染。
  title?: ReactNode;
  note?: ReactNode;
  extra?: ReactNode;
  /** 窄版: 表单型页面限制内容宽度, 避免视线横跨半个屏幕 */
  isNarrow?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`adm-panel${isNarrow ? ' is-narrow' : ''}`}>
      {title && (
        <div className="adm-panel-title">
          {title}
          {note && <span className="adm-panel-note">{note}</span>}
          {extra}
        </div>
      )}
      {children}
    </section>
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
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const handleChange = (keys: string | string[]) => {
    const next = Array.isArray(keys) ? keys.includes('panel') : keys === 'panel';
    if (open === undefined) setInner(next);
    onToggle?.(next);
  };

  return (
    <Collapse
      className={`adm-panel adm-panel-collapsible${isOpen ? ' is-open' : ''}`}
      activeKey={isOpen ? ['panel'] : []}
      onChange={handleChange}
      items={[
        {
          key: 'panel',
          label: (
            <span className="adm-panel-collapse-label">
              {title}
              {note && <span className="adm-panel-note">{note}</span>}
            </span>
          ),
          extra: isOpen ? extra : (collapsedHint ?? extra),
          children,
        },
      ]}
    />
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
    <Empty className="adm-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>
      {action}
    </Empty>
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
export type { TagTone };

/**
 * 状态标签。
 *
 * `label` 覆盖用于同一状态值在不同语境下中文不同 —— 订单的 `pending` 是
 * "待支付", 任务的 `pending` 是"等待", 共用一键没法在映射表里同时满足。
 */
export function StatusTag({
  status,
  label,
  tone,
}: {
  status: string;
  label?: string;
  /** 覆盖自动推导的语义色，供不同业务域复用同一状态值 */
  tone?: TagTone;
}) {
  const item = STATUS_META[status] ?? { label: status, tone: 'muted' as TagTone };
  return (
    <span className={`adm-tag ${TONE_CLASS[tone ?? item.tone]}`}>
      <span className="adm-tag-dot" aria-hidden="true" />
      {label ?? item.label}
    </span>
  );
}

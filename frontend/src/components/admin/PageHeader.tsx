import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Collapse, Empty, Flex, Space, Tag, Typography } from 'antd';
import { ChevronRight } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { findAdminMenuGroup, findAdminMenuItem } from './adminNav';

/** 状态语义色 → antd Tag 色值 */
const TONE_TO_ANTD: Record<TagTone, string> = {
  success: 'success',
  danger: 'error',
  warn: 'warning',
  brand: 'processing',
  muted: 'default',
};

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
  const location = useLocation();
  const group = findAdminMenuGroup(location.pathname);
  const current = findAdminMenuItem(location.pathname);

  return (
    <Flex className="adm-page-head" align="flex-start" justify="space-between" gap={16}>
      <div className="adm-page-head-main">
        <div className="adm-page-kicker" aria-label="当前位置">
          <span>运营后台</span>
          <ChevronRight size={12} aria-hidden="true" />
          <span>{group?.name ?? '工作台'}</span>
          {current && (
            <>
              <ChevronRight size={12} aria-hidden="true" />
              <strong>{current.label}</strong>
            </>
          )}
        </div>
        <Typography.Title level={4} className="adm-page-head-title" style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {description && (
          <Typography.Paragraph
            className="adm-page-head-desc"
            style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}
          >
            {description}
          </Typography.Paragraph>
        )}
      </div>
      {actions && (
        <Space className="adm-page-head-actions" size={8}>
          {actions}
        </Space>
      )}
    </Flex>
  );
}

/** 筛选条容器 */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <Flex className="adm-filter" align="center" gap={8} wrap="wrap">
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
    <Card
      className={`adm-panel${isNarrow ? ' is-narrow' : ''}`}
      style={{ padding: 0 }}
      styles={{ body: { padding: '20px 22px', width: '100%' } }}
    >
      {title && (
        <div className="adm-panel-title">
          {title}
          {note && <span className="adm-panel-note">{note}</span>}
          {extra}
        </div>
      )}
      {children}
    </Card>
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
  // 订单状态 (后端 Prisma Order.status)。`pending` 与任务状态共用同一个键,
  // 订单页通过 <StatusTag label="待支付"> 覆盖文案 —— 改这里的 label 会连带
  // 把任务页的"等待"也改掉。
  paid: { label: '已支付', tone: 'success' },
  refunded: { label: '已退款', tone: 'danger' },
  partial_refunded: { label: '部分退款', tone: 'warn' },
  // 商品状态 (后端 Prisma Product.status)
  offline: { label: '已下架', tone: 'muted' },
};

export type TagTone = 'success' | 'danger' | 'warn' | 'brand' | 'muted';

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
    <Tag color={TONE_TO_ANTD[tone ?? item.tone]} icon={<span className="adm-tag-dot" aria-hidden="true" />}>
      {label ?? item.label}
    </Tag>
  );
}

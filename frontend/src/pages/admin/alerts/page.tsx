import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  ALERT_CATEGORY_LABEL,
  SEVERITY_BADGE,
  SEVERITY_HINT,
  SEVERITY_SURFACE,
  SEVERITY_TONE,
  SeverityFilter,
} from './constants';
import { readSeverity } from './utils';
import { useAdminAlerts, useAdminUrlFilterSync } from './hooks';
import { Link, useSearchParams } from 'react-router-dom';

import {
  AdminPage,
  ActionButton,
  EmptyState,
  ListError,
  Panel,
  SegmentedGroup,
  SkeletonBody,
  type StatCardItem,
  StatCards,
  StaleError,
  ToneBadge,
  WorkQueue,
  WorkQueueSection,
} from '~/admin-ui/primitives';
import { useAdminWorkbench } from '../../../components/admin/WorkbenchContext';
import {
  ALERT_SEVERITY_META,
  AlertRefreshButton,
  alertTime,
} from '../../../components/admin/AlertCenter';
import type { AdminAlertSeverity } from '../../../types/api';

/**
 * 告警中心（/admin/alerts）。
 *
 * 顶栏铃铛只放前 5 条，这里给完整列表与口径说明。数据与铃铛同源：
 * 都来自 `GET /admin/alerts`，且按当前角色权限过滤 —— 财务看不到工单告警，
 * 运营看不到对账差异。没有待处理项时不制造「0 条告警」的噪音。
 *
 * ## 版面顺序：态势 → 清单 → 明细 → 口径
 *
 * 旧版把「可处理实体」放在页头下方，一屏 900px 里有 400px 是 5 行对账单据，
 * 真正的告警计数被挤到第二屏 —— 同一个「对账差异 37」还要在分组头、明细行、
 * 清单行各说一遍。现在按「先看全局，再下钻」排：统计卡回答有几种、各几条，
 * 清单回答分别是什么，明细只负责给出可直接点的单据样本，口径降为参考文献。
 *
 * 筛选级别同时写回地址栏（`?severity=`），告警深链从铃铛点进来时直接带着级别。
 */
export function AdminAlertsPage() {
  const { data, loading, error, reload } = useAdminAlerts();
  const {
    data: workbench,
    loading: workbenchLoading,
    error: workbenchError,
    reload: reloadWorkbench,
  } = useAdminWorkbench();
  const [searchParams] = useSearchParams();
  const initialFilter = readSeverity(searchParams.get('severity'));
  const [filter, setFilter] = useState<SeverityFilter>(initialFilter);
  const appliedUrlFilter = useRef<SeverityFilter>(initialFilter);

  useEffect(() => {
    const next = readSeverity(searchParams.get('severity'));
    if (next === appliedUrlFilter.current) return;
    appliedUrlFilter.current = next;
    setFilter(next);
  }, [searchParams]);

  useAdminUrlFilterSync({ severity: filter === 'all' ? undefined : filter });

  const chooseFilter = (next: SeverityFilter) => {
    appliedUrlFilter.current = next;
    setFilter(next);
  };

  const counts = useMemo(() => {
    const base: Record<AdminAlertSeverity, number> = { critical: 0, warning: 0, info: 0 };
    for (const item of data?.items ?? []) base[item.severity] += 1;
    return base;
  }, [data]);

  const items = useMemo(
    () =>
      filter === 'all'
        ? (data?.items ?? [])
        : (data?.items ?? []).filter((item) => item.severity === filter),
    [data, filter],
  );

  /*
   * 统计卡放最前：这一排是整页唯一能回答「今天有几件事、几件要命」的地方。
   * 「待处理告警」单独一张、不染色 —— 它是后三张的和，染色会跟分级抢读。
   */
  const statItems: StatCardItem[] = useMemo(
    () => [
      {
        key: 'total',
        label: '待处理告警',
        value: data?.total ?? '—',
        hint: data ? `数据截至 ${alertTime(data.generatedAt)}` : '正在检查…',
      },
      ...(['critical', 'warning', 'info'] as const).map((severity) => ({
        key: severity,
        label: ALERT_SEVERITY_META[severity].label,
        value: counts[severity],
        tone: counts[severity] > 0 ? SEVERITY_TONE[severity] : undefined,
        /*
         * 0 条时不能再念口径原文 ——「需处理 0 / 已有用户可见影响」是自相矛盾的。
         * 计数为 0 就给一句「没有」，有数才解释这一级意味着什么。
         */
        hint: SEVERITY_HINT[severity][counts[severity] > 0 ? 'some' : 'none'],
      })),
    ],
    [data, counts],
  );

  return (
    <AdminPage
      title="告警中心"
      description="聚合待处理工单、失败任务、对账差异、退款卡单、备份与发票状态。只列需要动作的事项，每 60 秒刷新一次。"
      actions={<AlertRefreshButton loading={loading} onRefresh={() => void reload()} />}
    >

      {error && data && <StaleError error={error} onRetry={() => void reload()} />}

      {/* 四张卡固定一行：数字之间要能横向比较「哪一级在涨」，折行就断了这层对照 */}
      <StatCards items={statItems} columns={4} className="mb-4" />

      <Panel
        title="待处理清单"
        note="来源按当前角色权限过滤，无权访问的模块不会出现在这里"
        extra={
          <SegmentedGroup
            ariaLabel="按告警级别筛选"
            value={filter}
            onChange={(value) => chooseFilter(value as SeverityFilter)}
            options={[
              { value: 'all', label: `全部 ${data?.total ?? 0}` },
              { value: 'critical', label: `紧急 ${counts.critical}` },
              { value: 'warning', label: `需处理 ${counts.warning}` },
              { value: 'info', label: `提示 ${counts.info}` },
            ]}
          />
        }
      >
        {loading && !data ? (
          /* 面板外壳已经是实的，只替内容行 —— 再套一层骨架就多了一道假边框 */
          <SkeletonBody rows={3} />
        ) : error && !data ? (
          <ListError error={error} onRetry={() => void reload()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={filter === 'all' ? '当前没有待处理告警' : '该级别下没有告警'}
            description={
              filter === 'all'
                ? '工单、任务、对账与备份都在正常范围内。'
                : '切换到「全部」查看其它级别。'
            }
            action={
              filter !== 'all' ? (
                <ActionButton variant="secondary" onClick={() => chooseFilter('all')}>
                  查看全部
                </ActionButton>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const meta = ALERT_SEVERITY_META[item.severity];
              const Icon = meta.icon;
              const surface = SEVERITY_SURFACE[item.severity];
              return (
                <li key={item.key}>
                  <Link
                    to={item.link}
                    className={`group flex items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors hover:bg-accent ${surface.card}`}
                    data-testid="admin-alert-row"
                  >
                    <span className={`shrink-0 ${surface.icon}`}>
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {item.title}
                        </span>
                        <ToneBadge tone={SEVERITY_BADGE[item.severity]}>{meta.label}</ToneBadge>
                      </span>
                      <span
                        className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"
                        title={item.detail}
                      >
                        {/* 来源用小字前缀，代替第二枚 badge —— 标题行已经没地方了 */}
                        <span className="shrink-0 rounded bg-muted px-1 py-px text-[11px] leading-4">
                          {ALERT_CATEGORY_LABEL[item.category]}
                        </span>
                        <span className="truncate">{item.detail}</span>
                      </span>
                    </span>
                    {item.count !== null && (
                      <span className="shrink-0 text-lg font-semibold text-foreground tabular-nums">
                        {item.count}
                      </span>
                    )}
                    {/* 整行是跳转，右侧给个箭头，别让「37」孤零零挂着像个数字装饰 */}
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="mb-4">
        <WorkQueueSection
          title="可处理明细"
          description="每组列出前几条可直接下钻的单据，完整列表走各模块。"
          actions={
            <ActionButton
              variant="secondary"
              size="sm"
              disabled={workbenchLoading}
              onClick={() => void reloadWorkbench()}
            >
              刷新待办
            </ActionButton>
          }
        >
          <WorkQueue
            groups={workbench?.groups ?? []}
            loading={workbenchLoading}
            error={workbenchError}
            emptyTitle="当前没有可展开的实体待办"
            emptyDescription="上方告警清单仍按来源给出计数。"
            hideEmptyGroups
          />
        </WorkQueueSection>
      </div>

      <Panel title="告警口径" note="计数是「当前待处理数」，被处理后自然消失">
        {/* 两列：六条口径是参考文献，占满整宽会把页面拉长一屏 */}
        <ul className="list-disc pl-4 text-xs leading-5 text-muted-foreground lg:columns-2 lg:gap-x-10">
          <li className="mb-1.5 break-inside-avoid">
            工单：存在尚未受理的「待回复」工单；已受理但仍在处理中的不重复告警；最早一条等待超过
            24 小时升为紧急。
          </li>
          <li className="mb-1.5 break-inside-avoid">
            任务：近 24 小时有失败任务，或运行中任务超过 50 个；失败达到 10 个升为紧急。
          </li>
          <li className="mb-1.5 break-inside-avoid">
            对账：仍有状态为「待处置」的差异；达到 5 笔升为紧急。
          </li>
          <li className="mb-1.5 break-inside-avoid">
            退款：渠道返回异步处理后超过 30 分钟仍未落账；最早一笔超过 24 小时升为紧急。点击直达订单列表的「渠道处理中」筛选。
          </li>
          <li className="mb-1.5 break-inside-avoid">
            备份：最近一次备份失败，或超过 48 小时没有成功备份；未验证的备份单独提示。
          </li>
          <li className="mb-1.5 break-inside-avoid">发票：存在待开具申请。</li>
        </ul>
        <p className="mt-3 text-[12px] leading-4 text-muted-foreground">
          不引入「已读」状态：事项被处理后自然消失，避免出现「点过就算解决」的假象。
        </p>
      </Panel>
    </AdminPage>
  );
}

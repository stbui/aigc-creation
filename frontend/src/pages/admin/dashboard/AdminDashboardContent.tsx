import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from './api';
import { useAdmin, useAdminResource, useAdminWorkbench } from './hooks';
import {
  ActionButton,
  AdminPage,
  Button,
  ExceptionPage,
  PageSkeleton,
  Panel,
  RefreshButton,
  SegmentedTabs,
  Skeleton,
  StaleError,
  TrendBarChart,
  WorkQueue,
} from './components';
import '../../../styles/radar-admin.css';
import type { AdminOverview, AdminWorkbenchRoleView } from '../../../types/api';
import {
  EmptyInline,
  FinanceGrid,
  MeterRow,
  Subhead,
} from './DashboardWidgets';
import { WindowStrip, TotalsStrip } from './DashboardMetricStrips';
import { CHANNEL_LABELS, yuan, taskErrorLabel } from './utils';

function DashboardControls({
  days,
  onDaysChange,
  view,
  canSwitchView,
  onViewChange,
  loading,
  onRefresh,
}: {
  days: number;
  onDaysChange: (days: number) => void;
  view: AdminWorkbenchRoleView;
  canSwitchView: boolean;
  onViewChange: (view: AdminWorkbenchRoleView) => void;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canSwitchView && (
        <SegmentedTabs
          ariaLabel="工作台视角"
          value={view}
          onChange={(value) => onViewChange(value as AdminWorkbenchRoleView)}
          options={[
            { value: 'admin', label: '管理员' },
            { value: 'operator', label: '运营' },
            { value: 'finance', label: '财务' },
          ]}
        />
      )}
      <SegmentedTabs
        ariaLabel="指标窗口"
        value={String(days)}
        onChange={(value) => onDaysChange(Number(value))}
        options={[7, 30, 90].map((value) => ({
          value: String(value),
          label: `近 ${value} 天`,
        }))}
      />
      <Button asChild variant="outline" size="sm">
        <Link to="/admin/alerts">告警中心</Link>
      </Button>
      <RefreshButton variant="outline" loading={loading} onRefresh={onRefresh} />
    </div>
  );
}

/**
 * 平台概览页面内容。
 *
 * 从 `AdminDashboardPage.tsx` 抽出：该文件此前同时承载路由表、后台外壳与本节
 * 内容三件事，本文件只负责「概览页怎么画」。外壳与路由挂载见 `layout.tsx`，
 * 子页懒加载表见 `routes.ts`。指标数据由本页自行拉取。
 */

/**
 * 平台概览。
 *
 * 首屏是可动作的工作台待办与经营读数；任务质量、收入明细等累计指标
 * 下沉到下方区块，不与「需要动作」的东西同权重。
 */
export function AdminDashboardContent() {
  const [days, setDays] = useState<number>(7);
  /*
   * 切换指标窗口与「重试」都走同一份资源：换窗口时旧数据留在屏幕上直到新数据
   * 到位，不再整页塌成骨架屏 —— 概览页塌一次，用户会以为刚看到的数字丢了。
   */
  const { data, loading, error, reload } = useAdminResource(() => adminApi.overview(days), [days]);
  const { can } = useAdmin();
  const {
    data: workbench,
    loading: workbenchLoading,
    error: workbenchError,
    view,
    canSwitchView,
    setView,
  } = useAdminWorkbench();
  /*
   * 财务没有任务读权：任务质量与任务趋势整块不渲染。管理员预览财务视角时
   * 也按财务版式渲染，但权限不变。
   */
  const isFinance = view === 'finance' || !can('task.read');
  const workbenchTitle =
    view === 'finance' ? '资金待办' : view === 'operator' ? '今日待办' : '系统待办';

  /*
   * 首屏骨架：只有完全没有数据时才塌**正文**。
   *
   * 页头照常渲染 —— 概览页是后台的门面，加载期间连标题都没有的话，用户会以为
   * 后台没打开。指标窗口分段与「刷新」按钮也在位（禁用），数据到位后它们不动。
   */
  if (loading && !data) {
    return (
      <PageSkeleton
        title="平台概览"
        actions={
          <DashboardControls
            days={days}
            onDaysChange={setDays}
            view={view}
            canSwitchView={canSwitchView}
            onViewChange={setView}
            loading
            onRefresh={reload}
          />
        }
        /*
         * 概览页的真实版面是工作台待办 + 一串折叠小节，用通用面板骨架
         * 顶住首屏，数据到位时不会整页横向重排。
         */
        body={
          <Panel title="工作台" note="读取中…">
            <Skeleton rows={4} />
          </Panel>
        }
      />
    );
  }
  if (error && !data) {
    return (
      <ExceptionPage
        kind="warning"
        title="统计数据加载失败"
        desc="概览数据未能加载，下方是后端返回的原因。确认服务可用后重试即可，不会影响已产生的任何数据。"
        detail={error}
        action={
          <ActionButton variant="default" onClick={() => void reload()}>
            重试
          </ActionButton>
        }
        showBack={false}
      />
    );
  }
  if (!data) return null;

  const c = data.commerce;
  const w = data.window;

  return (
    <AdminPage
      title="平台概览"
      actions={
        <DashboardControls
          days={days}
          onDaysChange={setDays}
          view={view}
          canSwitchView={canSwitchView}
          onViewChange={setView}
          loading={loading}
          onRefresh={reload}
        />
      }
    >
      {/* 换指标窗口失败时保留上一窗口的数字，但要明说这是旧的 */}
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      <WorkQueue
        groups={workbench?.groups ?? []}
        loading={workbenchLoading}
        error={workbenchError}
        emptyTitle={`${workbenchTitle}已清空`}
        emptyDescription="当前没有需要处理的事项。"
      />

      {/* 财务视角没有任务口径：交易概况用 overview 的订单数据单独成块 */}
      {isFinance && (
        <Panel title="交易概况" note={`近 ${days} 天汇总`}>
          <FinanceGrid commerce={c} days={days} />
        </Panel>
      )}

      {/*
       * 经营概况：窗口读数与累计存量合成一块。
       * 两者都是一排数字，拆成两张面板只会多一层标题与留白；用两条小节标题
       * 把「近 N 天」与「累计」隔开，避免两套口径被读成同一组数字。
       * 财务没有 task.read：窗口带里不出现任务口径，累计带里换成累计实收。
       */}
      <Panel title="经营概况">
        <Subhead title={`近 ${days} 天`} note={`对比上一个 ${days} 天`} />
        <WindowStrip data={data} finance={isFinance} />
        <div className="mt-4 border-t border-border pt-4">
          <Subhead title="累计存量" note="不受指标窗口影响" />
          <TotalsStrip data={data} finance={isFinance} />
        </div>
      </Panel>

      {/*
       * 任务质量：趋势与失败原因同属「任务在变好还是变坏」，并排放，
       * 不为两块各起一张面板。没有失败时不渲染右列 —— 标题已写明失败 0 个，
       * 不再留一块只有一句结论的空白列。
       */}
      {!isFinance && (
        <Panel
          title="任务质量"
          note={`近 ${days} 天 · 任务 ${w.tasks} 个 · 失败 ${w.failed} 个`}
          extra={
            w.failed > 0 ? (
              <Link className="text-[13px] text-radar-ink-950 hover:underline" to="/admin/tasks?status=failed">
                查看失败任务
              </Link>
            ) : undefined
          }
        >
          <div
            className={`grid grid-cols-1 items-start gap-7 ${
              w.failed > 0 ? 'lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]' : ''
            }`}
          >
            <div className="min-w-0">
              <Subhead title="每日任务量" note="失败日标红" />
              <TrendBarChart
                ariaLabel={`近 ${days} 天每日任务量`}
                empty="所选窗口内没有任务记录"
                items={data.trend.map((d) => ({
                  key: d.date,
                  date: d.date,
                  value: d.total,
                  title: `${d.date} · ${d.total} 个任务 · 失败 ${d.failed}`,
                  warn: d.failed > 0,
                }))}
              />
            </div>
            {w.failed > 0 && (
              <div className="min-w-0">
                <Subhead title="失败原因" note={`共 ${w.failed} 个`} />
                <div className="flex flex-col gap-2.5">
                  {w.failureReasons.map((reason) => (
                    <MeterRow
                      key={reason.errorCode}
                      label={taskErrorLabel(reason.errorCode)}
                      title={reason.errorCode}
                      value={reason.count}
                      total={w.failed}
                      hint={`${reason.count} 个 · ${Math.round((reason.count / w.failed) * 100)}%`}
                      tone="danger"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/*
       * 口径必须写在标题上：这里的「收入」是**订单实付**（元，Σ `Order.paidCents`），
       * 而财务分析页的「净收入」是**账单口径**（积分，Σ 已结算账单金额）。
       * 两个字指的是两笔账，页面上只写「收入」会让人把两处的数字对到一起，
       * 对不上就以为其中一处坏了。
       */}
      <Panel
        title="订单收入（元）"
        note={`近 ${days} 天 ¥${yuan(c.gmvWindowCents)} · 累计 ¥${yuan(c.gmvCents)}`}
        extra={
          <Link className="text-[13px] text-radar-ink-950 hover:underline" to="/admin/finance">
            积分口径净收入
          </Link>
        }
      >
        {c.channelMix.length === 0 ? (
          <EmptyInline>近 {days} 天没有支付记录。</EmptyInline>
        ) : (
          <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <Subhead title="收入趋势" note="按支付时间 · 订单实付" />
              <TrendBarChart
                ariaLabel={`近 ${days} 天每日订单收入`}
                empty="所选窗口内没有支付记录"
                valueFormatter={(value) => `¥${yuan(value, 0)}`}
                items={c.revenueTrend.map((d) => ({
                  key: d.date,
                  date: d.date,
                  value: d.gmvCents,
                  title: `${d.date} · ¥${yuan(d.gmvCents)} · ${d.orders} 单`,
                }))}
              />
            </div>
            <div className="min-w-0">
              <Subhead title="渠道构成" note="按实付金额" />
              <div className="flex flex-col gap-2.5">
                {c.channelMix.map((ch) => (
                  <MeterRow
                    key={ch.channel}
                    label={CHANNEL_LABELS[ch.channel] ?? ch.channel}
                    value={ch.gmvCents}
                    total={Math.max(c.gmvWindowCents, 1)}
                    hint={`¥${yuan(ch.gmvCents, 0)} · ${ch.orders} 单`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </Panel>
    </AdminPage>
  );
}

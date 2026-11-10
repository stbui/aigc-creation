import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../../lib/api';
import { useAdmin } from '../../../context/AdminContext';
import { ExceptionPage } from '../../../components/ExceptionPage';
import {
  ActionButton,
  Button,
  RefreshButton,
  PageHeader,
  PageSkeleton,
  Panel,
  SegmentedTabs,
  Skeleton,
  SkeletonDutyStrip,
  StaleError,
  DutyChannelTower,
  DutyStrip,
  TrendBarChart,
  WorkQueue,
  earliestFailure,
  useAdminResource,
} from '../../../admin-ui/primitives';
import { useDuty } from '../../../components/admin/DutyContext';
import { useAdminWorkbench } from '../../../components/admin/WorkbenchContext';
import type { AdminOverview } from '../../../types/api';
import {
  EmptyInline,
  FailureQueue,
  FinanceGrid,
  Fold,
  MachineStats,
  MeterRow,
  OrderQueue,
  OutputStrip,
  Subhead,
} from './DashboardWidgets';
import { WindowStrip, TotalsStrip } from './DashboardMetricStrips';
import { CHANNEL_LABELS, FRAME_LIMIT, hhmm, queueTime, yuan } from './utils';
import { taskErrorLabel } from '../../../lib/admin-error-codes';

/**
 * 平台概览（值班台）页面内容。
 *
 * 从 `AdminDashboardPage.tsx` 抽出：该文件此前同时承载路由表、后台外壳与本节
 * 内容三件事，本文件只负责「概览页怎么画」。外壳与路由挂载见 `AdminShell.tsx`，
 * 子页懒加载表见 `routes.ts`。值班数据（DutyContext）由外壳在 `/admin` index
 * 路由上挂载，切走即卸载，30 秒轮询随之停止。
 */

/**
 * 平台概览（值班台）。
 *
 * ## 首屏只回答三件事
 *
 * 有什么坏了（异常队列）→ 机器还在不在转（机器状态）→ 最近产出了什么
 * （产出条）。累计指标下沉到下方区块，不与「需要动作」的东西同权重。
 *
 * ## 与值班条同源
 *
 * 值班条与这里的队列读同一份 DutyContext 快照，不会出现「带子里 6 条异常、
 * 队列里 5 条」。财务没有 `task.read`：队列换成待付订单，机器状态换成交易
 * 指标，不请求任务接口。
 */
export function AdminDashboardContent() {
  const [days, setDays] = useState<number>(7);
  /*
   * 切换时间窗与「重试」都走同一份资源：换窗口时旧数据留在屏幕上直到新数据
   * 到位，不再整页塌成骨架屏 —— 概览页塌一次，用户会以为刚看到的数字丢了。
   */
  const { data, loading, error, reload } = useAdminResource(() => adminApi.overview(days), [days]);
  const { data: duty } = useDuty();
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
   * 财务没有任务读权：队列、产出条、任务趋势整体换成交易视角。
   * 管理员预览财务视角时也按财务版式渲染，但权限不变。
   */
  const isFinance = view === 'finance' || !can('task.read');
  const workbenchTitle =
    view === 'finance' ? '资金待办' : view === 'operator' ? '今日待办' : '系统待办';

  /*
   * 首屏骨架：只有完全没有数据时才塌**正文**。
   *
   * 页头照常渲染 —— 概览页是后台的门面，加载期间连标题都没有的话，用户会以为
   * 后台没打开。时间窗分段与「刷新」按钮也在位（禁用），数据到位后它们不动。
   */
  if (loading && !data) {
    return (
      <PageSkeleton
        title="平台概览"
        description={`${isFinance ? '经营' : '生成与经营'} · 近 ${days} 天`}
        actions={
          <>
            <SegmentedTabs
              ariaLabel="统计时间窗"
              value={String(days)}
              onChange={(value) => setDays(Number(value))}
              options={[7, 30, 90].map((value) => ({
                value: String(value),
                label: `近 ${value} 天`,
              }))}
            />
            <RefreshButton variant="outline" disabled />
          </>
        }
        /*
         * 概览页的真实版面不是「面板上下排」：值班条 + 62/38 双栏 + 一串
         * 折叠小节。用通用面板骨架顶上去，数据到位时整页会横向重排一次 ——
         * 所以这里自己画一份同构的骨架。
         */
        body={
          <>
            <SkeletonDutyStrip />
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,62fr)_minmax(0,38fr)]">
              <Panel title="队列" note="读取中…">
                <Skeleton rows={4} />
              </Panel>
              <Panel title="机器状态" note="读取中…">
                <Skeleton rows={3} />
              </Panel>
            </div>
          </>
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
  const tasks = duty?.tasks ?? [];
  /*
   * 带子上的「近 1 小时失败」与队列里的失败不是同一个时间窗：队列是最新
   * 100 条任务快照里的全部失败。把最早那条的时刻写到标题旁，读的人不用
   * 自己对「带子说 0、队列有 4 条」这件事。
   */
  const firstFailure = earliestFailure(tasks);

  return (
    <>
      <PageHeader
        title="平台概览"
        description={`${isFinance ? '经营' : '生成与经营'} · 近 ${days} 天 · 截至 ${hhmm(
          data.generatedAt,
        )} · 数据缓存 ${data.cacheTtlSeconds} 秒`}
        actions={
          <>
            {canSwitchView && (
              <SegmentedTabs
                ariaLabel="工作台视角"
                value={view}
                onChange={(value) => setView(value as typeof view)}
                options={[
                  { value: 'admin', label: '管理员' },
                  { value: 'operator', label: '运营' },
                  { value: 'finance', label: '财务' },
                ]}
              />
            )}
            <SegmentedTabs
              ariaLabel="统计时间窗"
              value={String(days)}
              onChange={(value) => setDays(Number(value))}
              options={[7, 30, 90].map((value) => ({
                value: String(value),
                label: `近 ${value} 天`,
              }))}
            />
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/alerts">告警中心</Link>
            </Button>
            <RefreshButton variant="outline" loading={loading} onRefresh={reload} />
          </>
        }
      />

      {/* 换时间窗失败时保留上一窗口的数字，但要明说这是旧的 */}
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      <DutyStrip />

      <WorkQueue
        groups={workbench?.groups ?? []}
        loading={workbenchLoading}
        error={workbenchError}
        emptyTitle={`${workbenchTitle}已清空`}
        emptyDescription="当前没有需要你处理的事项；下方仍保留经营与产出摘要。"
      />

      {/*
       * 首屏双栏：左 62% 给需要动作的队列，右 38% 给机器状态。
       * 不等分 —— 队列是「要做的事」，通道是「要确认的环境」，前者优先。
       */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,62fr)_minmax(0,38fr)]">
        {isFinance ? (
          <Panel
            title="待办队列"
            note={duty ? `最早 ${duty.orders.length} 笔待付 · 按创建时间` : '读取中…'}
            extra={
              <Link className="text-xs text-brand hover:underline" to="/admin/orders?status=pending">
                全部待付订单
              </Link>
            }
          >
            <OrderQueue orders={duty?.orders ?? []} loading={!duty} />
          </Panel>
        ) : (
          <Panel
            title="异常队列"
            note={
              duty
                ? `最近 ${tasks.length} 条任务中的失败${
                    firstFailure ? ` · 最早 ${queueTime(firstFailure.createdAt)}` : ' · 无'
                  }`
                : '读取中…'
            }
            extra={
              <Link className="text-xs text-brand hover:underline" to="/admin/tasks?status=failed">
                全部失败任务
              </Link>
            }
          >
            <FailureQueue tasks={tasks} loading={!duty} />
          </Panel>
        )}

        <Panel
          title="机器状态"
          note={
            isFinance
              ? `近 ${days} 天汇总`
              : duty
                ? duty.cooling > 0
                  ? `${duty.cooling} 条线路冷却中`
                  : '线路全部可用'
                : '读取中…'
          }
          extra={
            !isFinance && can('channel.read') ? (
              <Link className="text-xs text-brand hover:underline" to="/admin/channels">
                模型商品
              </Link>
            ) : undefined
          }
        >
          {isFinance ? (
            <FinanceGrid commerce={c} days={days} />
          ) : (
            <div className="flex flex-col gap-3.5">
              <DutyChannelTower limit={4} />
              <MachineStats tasks={tasks} />
            </div>
          )}
        </Panel>
      </div>

      {/*
       * 窗口表现：与首屏的实时读数分开。
       * 「任务总量 / 成功率」是历史累计，运营真正要看的是「最近这一档在变好
       * 还是变坏」，所以环比用紧邻的等长窗口做分母。
       */}
      <Fold>
        <Panel title={`近 ${days} 天`} note={`对比上一个 ${days} 天`}>
          <WindowStrip data={data} isFinance={isFinance} />
        </Panel>
      </Fold>

      {/*
       * 累计指标只回答「平台现在有多大」，与上方窗口表现分开。
       * 财务没有 task.read，因此不在这里重新引入任务成功率；改为累计实收，
       * 保持交易视角完整，也不让同一页出现两套相互竞争的任务口径。
       */}
      <Fold>
        <Panel title="平台存量" note="累计口径 · 不受上方时间窗影响">
          <TotalsStrip data={data} isFinance={isFinance} />
        </Panel>
      </Fold>

      {!isFinance && (
        <Fold>
          <Panel
            title="最近产出"
            note={`最近 ${tasks.length} 条任务里的成功产出 · 最多 ${FRAME_LIMIT} 张`}
            extra={
              <Link className="text-xs text-brand hover:underline" to="/admin/tasks">
                前往任务监控
              </Link>
            }
          >
            <OutputStrip tasks={tasks} />
          </Panel>
        </Fold>
      )}

      {!isFinance && (
        <Fold>
          <Panel title="任务趋势" note={`近 ${days} 天 · 有失败的日子标红`}>
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
          </Panel>
        </Fold>
      )}

      {!isFinance && (
        <Fold>
          <Panel
            title="失败原因"
            note={w.failed > 0 ? `近 ${days} 天共 ${w.failed} 条失败` : `近 ${days} 天没有失败任务`}
            extra={
              w.failed > 0 ? (
                <Link className="text-xs text-brand hover:underline" to="/admin/tasks?status=failed">
                  查看失败任务
                </Link>
              ) : undefined
            }
          >
            {w.failed === 0 ? (
              <EmptyInline>近 {days} 天没有失败任务</EmptyInline>
            ) : (
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
            )}
          </Panel>
        </Fold>
      )}

      <Fold>
        {/*
         * 口径必须写在标题上：这里的「收入」是**订单实付**（元，Σ `Order.paidCents`），
         * 而财务分析页的「净收入」是**账单口径**（积分，Σ 已结算账单金额）。
         * 两个字指的是两笔账，页面上只写「收入」会让人把两处的数字对到一起，
         * 对不上就以为其中一处坏了。标题带单位、备注写口径，并在两页之间给入口。
         */}
        <Panel
          title="订单收入（元）"
          note={`近 ${days} 天 ¥${yuan(c.gmvWindowCents)} · 累计 ¥${yuan(c.gmvCents)}`}
          extra={
            <Link className="text-xs text-brand hover:underline" to="/admin/finance">
              财务口径的净收入（积分）
            </Link>
          }
        >
          <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <Subhead title="收入趋势" note="按支付时间 · 单位：元 · 订单实付口径" />
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
              <Subhead title="渠道构成" note={`近 ${days} 天 · 按实付金额`} />
              {c.channelMix.length === 0 ? (
                <EmptyInline>所选窗口内没有支付记录</EmptyInline>
              ) : (
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
              )}
            </div>
          </div>
        </Panel>
      </Fold>
    </>
  );
}

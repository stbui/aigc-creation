import { useCallback, useEffect, useState } from 'react';
import { App } from 'antd';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Play, RefreshCw, XCircle } from 'lucide-react';
import { adminSchedulerApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { AdminListError, AdminListLoading, ConfirmAction } from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';
import type { AdminSchedulerStatus, AdminSchedulerTask } from '../../types/api';

/** 相对时间 —— 运维看的是"多久没跑了", 不是绝对时间 */
function since(iso: string | null): string {
  if (!iso) return '从未执行';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/** 上次没跑成功 → 用醒目色; 从未跑过 → 灰色 */
function freshness(t: AdminSchedulerTask): 'ok' | 'failed' | 'never' {
  if (t.consecutiveFailures > 0) return 'failed';
  if (!t.lastRunAt) return 'never';
  return 'ok';
}

/**
 * 定时任务 (admin-prd.md §3.18 B-90 / M9.5)。
 *
 * 这个页面的核心价值: **让"静默失败"变得可见**。
 * 一个没人看得出已经挂了三个月的定时任务, 比没有调度更危险 ——
 * 所有人都会以为它在跑。
 */
export function AdminSchedulerPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  const writable = can('setting.write');

  const [data, setData] = useState<AdminSchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runTarget, setRunTarget] = useState<AdminSchedulerTask | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await adminSchedulerApi.status());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 每 30 秒轮询: 调度器是分钟级节奏, 太频繁没意义, 太稀疏会漏看故障
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const runNow = async () => {
    if (!runTarget) return;
    setBusy(true);
    try {
      await adminSchedulerApi.run(runTarget.name);
      setRunTarget(null);
      void message.success(`「${runTarget.label}」已手动执行`);
      await load();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <AdminListLoading tip="加载定时任务状态…" />;
  if (error) return <AdminListError error={error} onRetry={() => void load()} />;
  if (!data) return <AdminEmpty description="暂无调度信息" />;

  const failing = data.failing;

  return (
    <>
      <PageHeader
        title="定时任务"
        description="订单超时关闭、积分到期回收、备份与保留期清理的统一调度"
        actions={
          <button type="button" className="adm-btn" onClick={() => void load()}>
            <RefreshCw size={14} style={{ marginRight: 6 }} />
            刷新
          </button>
        }
      />

      {/* 连续失败置顶告警: 这正是"没人看出调度已挂"的解药 */}
      {failing.length > 0 && (
        <div className="adm-alert is-danger">
          <AlertTriangle size={16} />
          <div>
            <strong>{failing.length} 个任务连续失败</strong>
            <div>
              涉及：
              {data.tasks
                .filter((t) => failing.includes(t.name))
                .map((t) => `${t.label}（${t.consecutiveFailures} 次）`)
                .join('、')}
            </div>
            <div>调度器不会因为单个任务失败而停止其它任务，但该任务已停止生效。</div>
          </div>
        </div>
      )}

      <Panel title="任务列表" note="每 10 分钟检查一次；单个任务失败不影响其它任务">
        <div className="adm-task-list">
          {data.tasks.map((t) => {
            const fresh = freshness(t);
            return (
              <div key={t.name} className={`adm-task-row is-${fresh}`}>
                <div className="adm-task-icon">
                  {fresh === 'failed' ? (
                    <XCircle size={18} />
                  ) : fresh === 'never' ? (
                    <Clock size={18} />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                </div>

                <div className="adm-task-main">
                  <div className="adm-task-title">
                    {t.label}
                    <code className="adm-mono adm-task-code">{t.name}</code>
                  </div>
                  <div className="adm-task-meta">
                    上次执行：{since(t.lastRunAt)}
                    {t.lastDurationMs !== null && ` · 耗时 ${t.lastDurationMs}ms`}
                    {t.totalRuns > 0 && ` · 累计 ${t.totalRuns} 次`}
                  </div>
                  {t.lastError && (
                    <div className="adm-task-error" title={t.lastError}>
                      {t.lastError}
                    </div>
                  )}
                </div>

                <div className="adm-task-actions">
                  {t.consecutiveFailures > 0 && (
                    <span className="adm-tag is-danger">
                      <span className="adm-tag-dot" />
                      连续失败 {t.consecutiveFailures}
                    </span>
                  )}
                  {data.manuallyRunnable.includes(t.name) &&
                    (writable ? (
                      <button
                        type="button"
                        className="adm-btn"
                        onClick={() => setRunTarget(t)}
                        disabled={busy}
                      >
                        <Play size={13} style={{ marginRight: 4 }} />
                        立即执行
                      </button>
                    ) : (
                      <span className="adm-cell-sub">仅查看</span>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="设计说明" note="为什么这些能手动触发、哪些不能">
        <ul className="adm-note-list">
          <li>
            <strong>可手动触发</strong>：订单超时关闭、积分到期回收。
            两者都是「扫一批已到期的」，重复执行不产生副作用 —— 这是幂等的前提。
          </li>
          <li>
            <strong>不可手动触发</strong>：备份、保留期清理。
            它们会写文件或删数据，被随意触发可能覆盖可用备份或误删未到期数据。
          </li>
          <li>
            <strong>失败隔离</strong>：每个任务独立捕获异常。
            早期版本用一个大 try 包住全部任务，结果备份一抛错，订单超时关闭就被跳过 ——
            订单不关闭会直接影响用户看到的可用金额。
          </li>
          <li>
            <strong>节流</strong>：订单关闭最短间隔 5 分钟、积分回收 10 分钟。
            订单超时是 30 分钟粒度，再密也没意义，而回收涉及多次写库。
          </li>
        </ul>
      </Panel>

      {runTarget && (
        <ConfirmAction
          open
          title={`立即执行「${runTarget.label}」`}
          confirmText="立即执行"
          loading={busy}
          onCancel={() => setRunTarget(null)}
          onConfirm={() => void runNow()}
          description={
            <p>
              忽略到期判定，立刻扫描并处理所有符合条件的记录。
            </p>
          }
          impact={
            runTarget.name === 'order-expire'
              ? [
                  '所有超时未支付的 pending 订单将被关闭',
                  '已支付订单不受影响',
                  '本操作幂等，重复执行安全',
                ]
              : [
                  '所有已到期且仍有剩余的积分批次将被回收',
                  '回收会写 expire 流水，积分归零但批次记录保留',
                  '本操作幂等，重复执行安全',
                ]
          }
          extra={
            <div className="adm-confirm-warn">
              <CalendarClock size={14} />
              <span>若调度器正在执行其它任务，本次触发会被跳过并提示重试。</span>
            </div>
          }
        />
      )}
    </>
  );
}
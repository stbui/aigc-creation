import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Copy, ExternalLink, ImageOff } from 'lucide-react';
import {
  ActionButton,
  AdminModal,
  Descriptions,
  DetailSection,
  Notice,
  StatusTag,
} from '~/admin-ui/primitives';
import { adminTasksApi, assetThumbUrl, toAbsoluteUrl } from './api';
import { useToast } from './hooks';
import { TaskFullChain } from './TaskFullChain';
import { TaskTimeline } from './TaskTimeline';
import {
  adminAssetHref,
  adminChannelHref,
  adminCreditHref,
  adminOrderHref,
  adminTaskHref,
  adminTasksHref,
  adminUserDetailHref,
  fmtBytes,
  formatDuration,
  taskErrorLabel,
} from './utils';
import type { AdminTask, AdminTaskDetail } from '../../../types/api';

type Row = AdminTask;

/**
 * 任务详情弹窗。
 *
 * 从页面拆出：详情的取数、状态流转、全链路排障与列表筛选/批量操作是两套
 * 生命周期，混在一个组件里会让列表重新渲染时详情跟着重算。
 *
 * 用居中弹窗而不是抽屉：全链路要并排 5 段摘要、产出图要按原比例预览，
 * 720px 的抽屉会把每一段都挤成两行。
 */
export function TaskDetailModal({
  detailId,
  rows,
  canRetry,
  canCancel,
  canDelete,
  canReadModelCalls,
  canReadBilling,
  canReadChannels,
  onClose,
  onAction,
}: {
  detailId: string | null;
  rows: Row[];
  canRetry: boolean;
  canCancel: boolean;
  canDelete: boolean;
  canReadModelCalls: boolean;
  canReadBilling: boolean;
  canReadChannels: boolean;
  onClose: () => void;
  onAction: (kind: 'retry' | 'cancel' | 'delete', task: Row) => void;
}) {
  const toast = useToast();
  const detailFetcher = useCallback(async () => {
    if (!detailId) throw new Error('任务不存在');
    return adminTasksApi.detail(detailId);
  }, [detailId]);

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label}已复制`);
    } catch {
      toast.error('复制失败', '浏览器未授权剪贴板访问，请手动选择文本复制。');
    }
  };

  return (
    <AdminModal<AdminTaskDetail>
      open={detailId !== null}
      title="任务详情"
      description="按同一任务 ID 串联提交、线路派发、模型调用与账单终态。"
      width={1120}
      onClose={onClose}
      fetcher={detailFetcher}
      footer={(d) => {
        /*
         * 直链打开时详情任务不一定在当前分页里。用详情字段合成一行摘要，
         * 保证重试 / 终止 / 删除动作仍然可用；列表里有时优先复用列表行。
         */
        const row: Row =
          rows.find((t) => t.id === d.id) ?? {
            id: d.id,
            capability: d.capability,
            capabilityName: d.capabilityName,
            status: d.status,
            errorCode: d.errorCode,
            creditCost: d.creditCost,
            retriedFromId: d.retriedFromId,
            user: d.user,
            project: d.project,
            durationMs: d.durationMs,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            thumbnailUrl: null,
          };
        return (
          <div className="flex w-full flex-wrap items-center gap-2">
            <ActionButton variant="ghost" size="sm" className="mr-auto" onClick={onClose}>
              关闭
            </ActionButton>
            {d.status === 'failed' && canRetry && (
              <ActionButton variant="default" size="sm" onClick={() => onAction('retry', row)}>
                重试此任务
              </ActionButton>
            )}
            {(d.status === 'queued' || d.status === 'running') && canCancel && (
              <ActionButton variant="destructive" size="sm" onClick={() => onAction('cancel', row)}>
                终止此任务
              </ActionButton>
            )}
            {(d.status === 'succeeded' || d.status === 'failed' || d.status === 'cancelled') &&
              canDelete && (
                <ActionButton
                  variant="ghost"
                  size="sm"
                  className="text-danger-text hover:text-danger-text"
                  onClick={() => onAction('delete', row)}
                >
                  删除此任务
                </ActionButton>
              )}
          </div>
        );
      }}
    >
      {(d) => {
        const errorLabel = d.errorCode ? taskErrorLabel(d.errorCode) : null;
        const createdAt = new Date(d.createdAt).toLocaleString('zh-CN');
        const updatedAt = new Date(d.updatedAt).toLocaleString('zh-CN');
        const paramsJson = JSON.stringify(d.params, null, 2) ?? '{}';
        const paramCount = Object.keys(d.params).length;

        return (
          <div className="flex flex-col gap-5">
            <section
              aria-labelledby="task-detail-heading"
              className="rounded-lg border border-border bg-muted/30 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusTag status={d.status} />
                    <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[12px] text-muted-foreground">
                      {d.capability}
                    </code>
                  </div>
                  <h2
                    id="task-detail-heading"
                    className="mt-2 text-lg leading-7 font-semibold text-foreground"
                  >
                    {d.capabilityName}
                  </h2>
                  <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                    <span className="shrink-0">任务 ID</span>
                    <code className="min-w-0 font-mono break-all text-foreground">{d.id}</code>
                  </p>
                </div>
                <ActionButton
                  variant="outline"
                  size="sm"
                  icon={Copy}
                  ariaLabel="复制任务 ID"
                  onClick={() => void copyText('任务 ID', d.id)}
                >
                  复制 ID
                </ActionButton>
              </div>
            </section>

            {d.status === 'failed' && (
              <Notice tone="danger" title="任务失败" className="mb-0">
                <div className="flex flex-col gap-1">
                  <span>{errorLabel ?? '未登记错误说明，请结合生成参数与模型调用记录排查。'}</span>
                  {d.errorCode && (
                    <span>
                      错误码：<code className="font-mono">{d.errorCode}</code>
                    </span>
                  )}
                  {/* 42204 无可用线路 / 42205 无遮罩编辑线路：原因在供应侧，给一键入口 */}
                  {(d.errorCode === '42204' || d.errorCode === '42205') && canReadChannels && (
                    <Link className="text-brand hover:underline" to={adminChannelHref()}>
                      前往渠道工作台检查线路
                    </Link>
                  )}
                </div>
              </Notice>
            )}

            <DetailSection title="任务概要">
              <Descriptions
                columns={3}
                items={[
                  {
                    label: '用户',
                    value: (
                      <span className="flex flex-col gap-1">
                        <Link
                          className="truncate text-brand hover:underline"
                          to={adminUserDetailHref(d.user.id)}
                        >
                          {d.user.email}
                        </Link>
                        <span className="flex gap-3 text-[12px]">
                          <Link
                            className="text-brand hover:underline"
                            to={adminCreditHref({
                              userId: d.user.id,
                              email: d.user.email,
                            })}
                          >
                            积分账本
                          </Link>
                          <Link
                            className="text-brand hover:underline"
                            to={adminOrderHref({ email: d.user.email })}
                          >
                            订单记录
                          </Link>
                        </span>
                      </span>
                    ),
                  },
                  {
                    label: '项目',
                    value: (
                      <Link
                        className="text-brand hover:underline"
                        to={adminTasksHref({ projectId: d.project.id })}
                      >
                        {d.project.name}
                      </Link>
                    ),
                  },
                  {
                    label: '积分消耗',
                    value: <span className="tabular-nums">{d.creditCost} 积分</span>,
                  },
                  {
                    label: '耗时',
                    value: <span className="tabular-nums">{formatDuration(d.durationMs)}</span>,
                  },
                  {
                    label: '创建时间',
                    value: (
                      <time className="tabular-nums" dateTime={d.createdAt}>
                        {createdAt}
                      </time>
                    ),
                  },
                  {
                    label: '最后更新',
                    value: (
                      <time className="tabular-nums" dateTime={d.updatedAt}>
                        {updatedAt}
                      </time>
                    ),
                  },
                  ...(d.retriedFromId
                    ? [
                        {
                          label: '重试来源',
                          value: (
                            <Link
                              className="text-brand hover:underline"
                              to={adminTaskHref(d.retriedFromId)}
                            >
                              <code className="break-all font-mono text-xs">{d.retriedFromId}</code>
                            </Link>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </DetailSection>

            <DetailSection
              title="状态流转"
              note={
                d.status === 'queued'
                  ? `已等待 ${formatDuration(d.durationMs)}`
                  : d.status === 'running'
                    ? `已执行 ${formatDuration(d.durationMs)}`
                    : `总耗时 ${formatDuration(d.durationMs)}`
              }
            >
              <TaskTimeline
                items={d.timeline.map((n) => ({
                  title: n.label,
                  state:
                    n.key === 'finished'
                      ? n.done
                        ? d.status === 'failed'
                          ? 'failed'
                          : d.status === 'cancelled'
                            ? 'cancelled'
                            : 'done'
                        : d.status === 'queued'
                          ? 'pending'
                          : 'active'
                      : 'done',
                  description: n.at
                    ? new Date(n.at).toLocaleString('zh-CN')
                    : n.done
                      ? '未记录具体时间'
                      : d.status === 'queued'
                        ? '尚未开始'
                        : '进行中',
                }))}
              />
            </DetailSection>

            <TaskFullChain
              task={d}
              canReadBilling={canReadBilling}
              canReadModelCalls={canReadModelCalls}
            />

            <DetailSection title="产出图">
              {d.outputAsset ? (
                <div className="flex flex-wrap items-start gap-5">
                  <Link
                    className="block max-w-full overflow-hidden rounded-lg border border-border bg-muted/20"
                    to={adminAssetHref(d.outputAsset.id)}
                    aria-label="在素材库查看产出图"
                  >
                    <img
                      className="max-h-[480px] max-w-full object-contain"
                      src={toAbsoluteUrl(d.outputAsset.sourceUrl)}
                      alt="任务产出图"
                    />
                  </Link>
                  <div className="flex min-w-[168px] flex-col gap-3">
                    <Descriptions
                      items={[
                        {
                          label: '尺寸',
                          value: (
                            <span className="tabular-nums">
                              {d.outputAsset.width && d.outputAsset.height
                                ? `${d.outputAsset.width}×${d.outputAsset.height}`
                                : '尺寸未知'}
                            </span>
                          ),
                        },
                        { label: '格式', value: d.outputAsset.format },
                        {
                          label: '文件大小',
                          value: <span className="tabular-nums">{fmtBytes(d.outputAsset.sizeBytes)}</span>,
                        },
                      ]}
                    />
                    <Link
                      className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline"
                      to={adminAssetHref(d.outputAsset.id)}
                    >
                      在素材库查看
                      <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                  <ImageOff className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <p>
                    {d.status === 'succeeded'
                      ? '任务已完成但未关联产出图，数据可能异常，请核对任务记录。'
                      : '任务尚未产出图片。'}
                  </p>
                </div>
              )}
            </DetailSection>

            {d.inputAssets.length > 0 && (
              <DetailSection
                title="输入素材"
                note={`共 ${d.inputAssets.length} 张，按提交顺序排列`}
              >
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {d.inputAssets.map((a, i) => (
                    <div key={a.id} className="min-w-0">
                      <Link
                        className="group block overflow-hidden rounded-lg border border-border bg-muted"
                        to={adminAssetHref(a.id)}
                        aria-label={`查看输入素材 ${i + 1}`}
                        title={`输入素材 ${i + 1}`}
                      >
                        <img
                          className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                          src={assetThumbUrl(a.sourceUrl, 400)}
                          alt={`输入素材 ${i + 1}`}
                          loading="lazy"
                        />
                      </Link>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
                        <span>素材 {i + 1}</span>
                        <span className="shrink-0 tabular-nums">
                          {a.width && a.height ? `${a.width}×${a.height}` : '尺寸未知'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}

            <DetailSection
              title="生成参数"
              note={
                <span className="inline-flex items-center gap-2">
                  {paramCount} 个字段
                  <ActionButton
                    variant="ghost"
                    size="xs"
                    icon={Copy}
                    ariaLabel="复制生成参数 JSON"
                    className="h-6 px-2 text-[12px]"
                    onClick={() => void copyText('生成参数', paramsJson)}
                  >
                    复制 JSON
                  </ActionButton>
                </span>
              }
            >
              <pre className="max-h-[360px] overflow-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap break-words text-foreground">
                {paramsJson}
              </pre>
            </DetailSection>
          </div>
        );
      }}
    </AdminModal>
  );
}

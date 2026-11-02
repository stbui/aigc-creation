import { useCallback, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import {
  ActionButton,
  AdminDrawer,
  Descriptions,
  DetailSection,
  StatusTag,
} from './components';
import { adminTasksApi, assetThumbUrl, toAbsoluteUrl } from './api';
import { PROVIDER_LABELS } from './constants';
import {
  adminAssetHref,
  adminCreditHref,
  adminOrderHref,
  adminTaskHref,
  adminTasksHref,
  adminUserDetailHref,
  cn,
  fmtBytes,
  formatDuration,
  taskErrorLabel,
} from './utils';
import type { AdminTask, AdminTaskDetail } from '../../../types/api';

type Row = AdminTask;

/**
 * 状态流转时间线。
 *
 * 新 primitives 层没有 Steps，这里按详情抽屉的需要本地实现：节点用序号 /
 * 对勾双编码，颜色仍走语义令牌（完成绿、进行中品牌紫、未开始灰）。
 */
function Steps({
  items,
}: {
  items: Array<{ title: string; done: boolean; active: boolean; description: ReactNode }>;
}) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((node, index) => (
        <li key={index} className="flex gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[12px] tabular-nums',
              node.done
                ? 'border-success-text bg-success-soft text-success-text'
                : node.active
                  ? 'border-brand bg-accent text-brand'
                  : 'border-border bg-muted text-muted-foreground',
            )}
          >
            {node.done ? <Check className="size-3" aria-hidden /> : index + 1}
          </span>
          <div className="min-w-0">
            <div
              className={cn(
                'text-sm',
                node.done || node.active
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {node.title}
            </div>
            <div className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
              {node.description}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * 任务详情抽屉。
 *
 * 从页面拆出：抽屉的数据获取、状态流转与产出预览与列表筛选/批量操作是两套
 * 生命周期，混在一个组件里会让列表重新渲染时抽屉跟着重算。
 */
export function TaskDetailDrawer({
  detailId,
  rows,
  canRetry,
  canCancel,
  onClose,
  onAction,
}: {
  detailId: string | null;
  rows: Row[];
  canRetry: boolean;
  canCancel: boolean;
  onClose: () => void;
  onAction: (kind: 'retry' | 'cancel', task: Row) => void;
}) {
  const detailFetcher = useCallback(async () => {
    if (!detailId) throw new Error('任务不存在');
    return adminTasksApi.detail(detailId);
  }, [detailId]);

  return (
    <AdminDrawer<AdminTaskDetail>
      open={detailId !== null}
      title="任务详情"
      onClose={onClose}
      fetcher={detailFetcher}
      footer={(d) => {
        const row = rows.find((t) => t.id === d.id);
        if (!row) return null;
        return (
          <div className="flex items-center justify-end gap-2">
            {d.status === 'failed' && canRetry && (
              <ActionButton variant="default" size="sm" onClick={() => onAction('retry', row)}>
                重试此任务
              </ActionButton>
            )}
            {(d.status === 'queued' || d.status === 'running') && canCancel && (
              <ActionButton
                variant="destructive"
                size="sm"
                onClick={() => onAction('cancel', row)}
              >
                终止此任务
              </ActionButton>
            )}
          </div>
        );
      }}
    >
      {(d) => (
        <div className="flex flex-col gap-4">
          <DetailSection title="任务概要">
            <Descriptions
              columns={2}
              items={[
                {
                  label: '任务 ID',
                  value: <code className="break-all font-mono text-xs">{d.id}</code>,
                },
                {
                  label: '能力',
                  value: (
                    <span className="flex flex-col">
                      {d.capabilityName}
                      <code className="font-mono text-[12px] text-muted-foreground">
                        {d.capability}
                      </code>
                    </span>
                  ),
                },
                {
                  label: '状态',
                  value: (
                    <span className="flex flex-col gap-0.5">
                      <StatusTag status={d.status} />
                      {d.errorCode && (
                        <span className="text-[12px] text-muted-foreground">
                          {taskErrorLabel(d.errorCode) === d.errorCode
                            ? d.errorCode
                            : `${d.errorCode} · ${taskErrorLabel(d.errorCode)}`}
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  label: '通道',
                  /* 与列表列同一规则：`pending` 是建任务的初值，任务已经失败时
                   * 再写「待执行」会和上面的「失败」互相矛盾。 */
                  value:
                    !d.provider || (d.provider === 'pending' && d.status !== 'queued')
                      ? '—'
                      : (PROVIDER_LABELS[d.provider] ?? d.provider),
                },
                {
                  label: '用户',
                  value: (
                    <span className="flex flex-col gap-1">
                      <Link
                        className="text-brand hover:underline"
                        to={adminUserDetailHref(d.user.id)}
                      >
                        {d.user.email}
                      </Link>
                      <span className="flex gap-3 text-[12px]">
                        <Link
                          className="text-brand hover:underline"
                          to={adminCreditHref({ userId: d.user.id, email: d.user.email })}
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
                  label: '耗时',
                  value: <span className="tabular-nums">{formatDuration(d.durationMs)}</span>,
                },
                {
                  label: '创建时间',
                  value: (
                    <span className="tabular-nums">
                      {new Date(d.createdAt).toLocaleString('zh-CN')}
                    </span>
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
                            <code className="font-mono text-xs">{d.retriedFromId}</code>
                          </Link>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </DetailSection>

          <DetailSection title="状态流转">
            <Steps
              items={d.timeline.map((n) => ({
                title: n.label,
                done: n.done,
                active: !n.done && d.status !== 'queued',
                /*
                 * 没有时间的节点不能一律写「进行中」——
                 * pending 任务的终态节点会因此被误读成"已经开跑了"。
                 */
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

          <DetailSection title="产出图">
            {d.outputAsset ? (
              <>
                {/* 产出图尺寸不一, 限高避免撑爆抽屉; 原图去素材库看 */}
                <img
                  className="max-h-[320px] w-auto rounded-lg border border-border"
                  src={toAbsoluteUrl(d.outputAsset.sourceUrl)}
                  alt="产出图"
                />
                <div className="mt-1.5 text-[12px] text-muted-foreground">
                  {d.outputAsset.width && d.outputAsset.height
                    ? `${d.outputAsset.width}×${d.outputAsset.height}`
                    : '尺寸未知'}{' '}
                  · {d.outputAsset.format} · {fmtBytes(d.outputAsset.sizeBytes)}
                  {' · '}
                  <Link
                    className="text-brand hover:underline"
                    to={adminAssetHref(d.outputAsset.id)}
                  >
                    在素材库查看
                  </Link>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {d.status === 'succeeded'
                  ? '任务已完成但未关联产出图，数据可能异常，请核对任务记录。'
                  : '任务尚未产出图片。'}
              </p>
            )}
          </DetailSection>

          {d.inputAssets.length > 0 && (
            <DetailSection title="输入素材" note={`共 ${d.inputAssets.length} 张，按提交顺序排列`}>
              <div className="grid grid-cols-5 gap-1.5">
                {d.inputAssets.map((a, i) => (
                  <img
                    key={a.id}
                    className="aspect-square w-full rounded-md border border-border object-cover"
                    src={assetThumbUrl(a.sourceUrl, 240)}
                    alt={`输入素材 ${i + 1}`}
                    loading="lazy"
                  />
                ))}
              </div>
            </DetailSection>
          )}

          <DetailSection title="生成参数">
            <pre className="max-h-[320px] overflow-auto rounded-lg border border-border bg-muted p-3 text-[12px] leading-5 text-muted-foreground">
              {JSON.stringify(d.params, null, 2)}
            </pre>
          </DetailSection>
        </div>
      )}
    </AdminDrawer>
  );
}

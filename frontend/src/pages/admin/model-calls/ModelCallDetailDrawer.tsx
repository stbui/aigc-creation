import { ActionButton, Descriptions, Drawer, Notice, formatDateTime, formatDuration } from '~/admin-ui/primitives';
import type { ApiLogView } from '../../../types/model';
import {
  CAPABILITY_LABELS,
  OPERATION_LABELS,
  REQUEST_KIND_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from './constants';

export function ModelCallDetailDrawer({
  detailId,
  detail,
  onClose,
}: {
  detailId: string | null;
  detail: ApiLogView | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={detailId !== null}
      onClose={onClose}
      size="lg"
      title="调用详情"
      description={detail ? `${detail.method} ${detail.path}` : undefined}
      footer={
        <ActionButton variant="secondary" size="sm" onClick={onClose}>
          关闭
        </ActionButton>
      }
    >
      {detail ? (
        <div className="flex flex-col gap-4">
          {detail.error && (
            <Notice tone="danger" title={`调用失败${detail.errorCode ? `（${detail.errorCode}）` : ''}`}>
              {detail.error}
            </Notice>
          )}
          <Descriptions
            items={[
              {
                label: '状态',
                value: `${STATUS_LABELS[detail.status] ?? detail.status} · HTTP ${detail.statusCode || '—'}`,
              },
              {
                label: '请求类型',
                value: `${REQUEST_KIND_LABELS[detail.requestKind] ?? detail.requestKind}${detail.billable ? '（计费）' : '（不计费）'}`,
              },
              {
                label: '来源',
                value: (SOURCE_LABELS[detail.source] ?? detail.source) || '—',
              },
              { label: '渠道', value: `${detail.channelName || '—'}（${detail.channelId || '—'}）` },
              { label: '模型', value: <span className="font-mono text-xs">{detail.model || '—'}</span> },
              { label: '协议 / 格式', value: detail.apiFormat || '—' },
              {
                label: '能力 / 操作',
                value: `${CAPABILITY_LABELS[detail.capability] ?? detail.capability ?? '—'} · ${OPERATION_LABELS[detail.operation] ?? detail.operation ?? '—'}`,
              },
              {
                label: '耗时',
                value: `${formatDuration(detail.durationMs)}${detail.pollCount > 0 ? ` · 第 ${detail.pollCount} 次轮询` : ''}`,
              },
              { label: '上游状态', value: detail.providerStatus || '—' },
              {
                label: '请求方法',
                value: <span className="font-mono text-xs">{detail.method || '—'}</span>,
              },
              {
                label: '请求路径',
                value: <span className="break-all font-mono text-xs">{detail.path || '—'}</span>,
              },
              {
                label: '上游请求号',
                value: <span className="font-mono text-xs">{detail.providerRequestId || '—'}</span>,
              },
              {
                label: '任务',
                value: <span className="font-mono text-xs">{detail.taskId || '—'}</span>,
              },
              {
                label: '账单',
                value: <span className="font-mono text-xs">{detail.billingOrderId || '—'}</span>,
              },
              { label: '用户', value: detail.userId || '—' },
              {
                label: '请求号',
                value: <span className="font-mono text-xs">{detail.requestId || '—'}</span>,
              },
              {
                label: '追踪号',
                value: <span className="font-mono text-xs">{detail.traceId || '—'}</span>,
              },
              {
                label: 'Token 用量',
                value: detail.usageAvailable
                  ? `输入 ${detail.inputTokens} · 输出 ${detail.outputTokens} · 缓存 ${detail.cachedTokens}`
                  : '无用量数据',
              },
              {
                label: '产出',
                value: `${detail.mediaCount} 个媒体${detail.videoSeconds > 0 ? ` · ${detail.videoSeconds}s` : ''}`,
              },
              { label: '时间', value: formatDateTime(detail.createdAt) },
            ]}
            columns={2}
            inline
          />
        </div>
      ) : (
        <p className="py-6 text-center text-xs text-muted-foreground">
          该记录不在当前页。请回到列表按任务 ID 或渠道 ID 定位。
        </p>
      )}
    </Drawer>
  );
}

import { useCallback } from 'react';
import { Copy } from 'lucide-react';
import { ActionButton, AdminDrawer, Descriptions, DetailSection, Notice } from './components';
import { adminApiLogsApi } from './api';
import {
  CAPABILITY_LABELS,
  OPERATION_LABELS,
  REQUEST_KIND_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from './constants';
import { useToast } from './hooks';
import type { ApiLogDetailView } from './types';
import { formatDateTime, formatDuration } from './utils';

/**
 * 单条调用记录的详情抽屉。
 *
 * 基础字段随列表下发，请求 / 响应报文只有详情接口才有 —— 一页 50 条各自可能
 * 带上百 KB 的上游响应，列表不值得为它们背体积。所以这里是「点开再拉」，
 * 而不是从列表行里切字段。
 */
export function Detail({ detailId, onClose }: { detailId: string | null; onClose: () => void }) {
  const toast = useToast();
  const fetcher = useCallback(async () => {
    if (!detailId) throw new Error('调用记录不存在');
    return adminApiLogsApi.detail(detailId);
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
    <AdminDrawer<ApiLogDetailView>
      open={detailId !== null}
      title="调用详情"
      description="一次上游 HTTP 调用：请求报文、上游响应与账单关联。"
      onClose={onClose}
      fetcher={fetcher}
      footer={() => (
        <ActionButton variant="secondary" size="sm" onClick={onClose}>
          关闭
        </ActionButton>
      )}
    >
      {(detail) => (
        <div className="flex flex-col gap-5">
          {detail.error && (
            <Notice
              tone="danger"
              title={`调用失败${detail.errorCode ? `（${detail.errorCode}）` : ''}`}
            >
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
              {
                label: '渠道',
                value: `${detail.channelName || '—'}（${detail.channelId || '—'}）`,
              },
              {
                label: '模型',
                value: <span className="font-mono text-xs">{detail.model || '—'}</span>,
              },
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

          <DetailSection
            title="请求报文"
            note={
              <span className="inline-flex items-center gap-2">
                {detail.requestContentType || '未知类型'}
                {detail.requestBody && (
                  <ActionButton
                    variant="ghost"
                    size="xs"
                    icon={Copy}
                    ariaLabel="复制请求报文"
                    className="h-6 px-2 text-[12px]"
                    onClick={() => void copyText('请求报文', detail.requestBody)}
                  >
                    复制
                  </ActionButton>
                )}
              </span>
            }
          >
            {detail.upstreamUrl && (
              <p className="mb-2 break-all font-mono text-[12px] text-muted-foreground">
                {detail.method} {detail.upstreamUrl}
              </p>
            )}
            <PayloadBlock
              text={detail.requestBody}
              emptyText="本次调用没有请求体（如轮询 GET，或请求在构建阶段就失败）。"
            />
          </DetailSection>

          <DetailSection
            title="响应报文"
            note={
              detail.responseBody ? (
                <ActionButton
                  variant="ghost"
                  size="xs"
                  icon={Copy}
                  ariaLabel="复制响应报文"
                  className="h-6 px-2 text-[12px]"
                  onClick={() => void copyText('响应报文', detail.responseBody)}
                >
                  复制
                </ActionButton>
              ) : undefined
            }
          >
            <PayloadBlock
              text={detail.responseBody}
              emptyText="本次调用没有记录到响应体（连接中断、超时前未收到数据）。"
            />
          </DetailSection>
        </div>
      )}
    </AdminDrawer>
  );
}

/**
 * 报文预览块。
 *
 * 报文是明文入库，只在内嵌媒体（data URL / base64）与超长内容上做过折叠与截断。
 * 这里原样展示、不做二次处理 —— 后台再裁一次会让「界面看到的」和「库里存的」
 * 出现两套口径；`max-h` 只负责滚动视口。
 */
function PayloadBlock({ text, emptyText }: { text: string; emptyText: string }) {
  if (!text.trim()) {
    return <p className="py-2 text-[12.5px] text-muted-foreground">{emptyText}</p>;
  }
  return (
    <pre className="max-h-[320px] overflow-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap break-words text-foreground">
      {text}
    </pre>
  );
}

import { Download, RefreshCw } from 'lucide-react';

import type { ToolResult } from './components';
import { Badge, Button } from './components';
import { MultiFusionResultStage } from './MultiFusionResultStage';
import { fusionResultStatusOf, type FusionFailureKind, type FusionResultState } from './utils';

/**
 * 结果面板 —— 状态条 / 动作按钮 + 舞台区。
 *
 * 六种状态：空态 / 生成中 / 失败 / 完整成功 / 部分成功 / 无可用图片。
 * 数量是状态的一部分：请求 4 张只回来 1 张时必须显示“部分成功”，不能
 * 让用户把一次缺图误读成完整交付。
 *
 * 状态判定（`fusionResultStatusOf`）与画面渲染（`MultiFusionResultStage`）分离：
 * 本组件只把状态映射成标题、徽标与按钮可用性。
 *
 * 2026-11-21 状态条改为 shadcn `Badge`（色调按状态映射），动作改为 shadcn
 * `Button variant="outline" size="sm"`，不再各写一份 `result-actions button` 规则。
 */
const STATUS_BADGE_CLASS: Record<FusionResultState, string> = {
  idle: '',
  generating: 'border-brand/35 bg-brand-bg text-brand',
  complete: 'border-success-border bg-success-soft text-success-text',
  partial: 'border-warn-border bg-warn-soft text-warn-text',
  failed: 'border-danger-soft bg-danger-soft text-danger-text',
  submit_failed: 'border-danger-soft bg-danger-soft text-danger-text',
  timeout: 'border-warn-border bg-warn-soft text-warn-text',
};

export function MultiFusionResultPanel({
  submitting,
  results,
  activeResult,
  activeResultIndex,
  lastFailure,
  failureKind,
  requestedCount,
  ratio,
  ratioWidth,
  ratioHeight,
  canRegenerate,
  onRetryPoll,
  onRegenerate,
  onDownload,
  onSelectResult,
}: {
  submitting: boolean;
  results: ToolResult[];
  activeResult: ToolResult | null;
  activeResultIndex: number;
  lastFailure: ToolResult | null;
  failureKind: FusionFailureKind | null;
  /** 本次提交实际请求的变体数，不随生成后的参数选择变化 */
  requestedCount: number;
  ratio: string;
  ratioWidth: number;
  ratioHeight: number;
  /** 重新生成按钮的禁用判定由页面持有（提交中 / 能力不可用 / 没有可重试状态） */
  canRegenerate: boolean;
  /** 超时任务沿用原 taskId 再查询，不重新发起生成 */
  onRetryPoll?: () => void;
  onRegenerate: () => void;
  onDownload: () => void;
  onSelectResult: (index: number) => void;
}) {
  const status = fusionResultStatusOf({
    submitting,
    resultCount: results.length,
    requestedCount,
    failureKind,
  });
  const statusRole =
    status.state === 'failed' || status.state === 'submit_failed' ? 'alert' : 'status';

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-[linear-gradient(145deg,var(--card-bg),var(--brand-bg))] p-5.5 max-[640px]:p-3">
      <div className="mb-4 flex items-start justify-between gap-4.5 max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2.5">
        <div className="min-w-0">
          <h2 className="m-0 mt-0.5 text-lg leading-6.25 font-bold text-foreground">生成结果</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {status.badge && (
              <Badge
                variant="outline"
                className={`h-5.5 rounded-full px-2 font-semibold ${STATUS_BADGE_CLASS[status.state]}`}
                role={statusRole}
                aria-live="polite"
              >
                {status.badge}
              </Badge>
            )}
            <p className="m-0 text-xs leading-4.75 text-muted-foreground">
              {status.summary} · {ratio}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.75 max-[640px]:w-full">
          {status.state === 'timeout' && onRetryPoll && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.25 px-2.5 text-xs max-[640px]:flex-1"
              onClick={onRetryPoll}
            >
              <RefreshCw aria-hidden />
              重新查询
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.25 px-2.5 text-xs max-[640px]:flex-1"
            disabled={!canRegenerate}
            onClick={onRegenerate}
          >
            <RefreshCw aria-hidden />
            重新生成
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.25 px-2.5 text-xs max-[640px]:flex-1"
            disabled={!activeResult?.url}
            onClick={onDownload}
          >
            <Download aria-hidden />
            下载当前图
          </Button>
        </div>
      </div>

      <MultiFusionResultStage
        status={status}
        submitting={submitting}
        results={results}
        activeResult={activeResult}
        activeResultIndex={activeResultIndex}
        lastFailure={lastFailure}
        requestedCount={requestedCount}
        ratioWidth={ratioWidth}
        ratioHeight={ratioHeight}
        onSelectResult={onSelectResult}
      />
    </section>
  );
}

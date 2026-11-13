import { Download, RefreshCw } from 'lucide-react';

import type { ToolResult } from './components';
import { MultiFusionResultStage } from './MultiFusionResultStage';
import { fusionResultStatusOf, type FusionFailureKind } from './utils';

/**
 * 结果面板 —— 状态条 / 动作按钮 + 舞台区。
 *
 * 六种状态：空态 / 生成中 / 失败 / 完整成功 / 部分成功 / 无可用图片。
 * 数量是状态的一部分：请求 4 张只回来 1 张时必须显示“部分成功”，不能
 * 让用户把一次缺图误读成完整交付。
 *
 * 状态判定（`fusionResultStatusOf`）与画面渲染（`MultiFusionResultStage`）分离：
 * 本组件只把状态映射成标题、徽标与按钮可用性。
 */
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
    <section className="multi-image-fusion-result-panel">
      <div className="multi-image-fusion-result-heading">
        <div className="multi-image-fusion-result-heading-copy">
          <h2>生成结果</h2>
          <div className="multi-image-fusion-result-meta">
            {status.badge && (
              <span
                className={`multi-image-fusion-result-status is-${status.state}`}
                role={statusRole}
                aria-live="polite"
              >
                {status.badge}
              </span>
            )}
            <p>
              {status.summary} · {ratio}
            </p>
          </div>
        </div>
        <div className="multi-image-fusion-result-actions">
          {status.state === 'timeout' && onRetryPoll && (
            <button type="button" onClick={onRetryPoll}>
              <RefreshCw size={13} />
              重新查询
            </button>
          )}
          <button type="button" disabled={!canRegenerate} onClick={onRegenerate}>
            <RefreshCw size={13} />
            重新生成
          </button>
          <button type="button" disabled={!activeResult?.url} onClick={onDownload}>
            <Download size={13} />
            下载当前图
          </button>
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

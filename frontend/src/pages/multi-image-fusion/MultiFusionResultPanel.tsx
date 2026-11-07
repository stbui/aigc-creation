import { Download, ImagePlus, Layers, RefreshCw, Sparkles } from 'lucide-react';

import { EMPTY_HINT, EMPTY_TITLE } from './constants';
import { ToolGeneratingState, type ToolResult } from './components';
import { assetThumbUrl } from './api';
import { fusionFailureText, fusionResultStatusOf, type FusionFailureKind } from './utils';

/**
 * 结果面板 —— 变体预览 + 缩略图切换。
 *
 * 六种状态：空态 / 生成中 / 失败 / 完整成功 / 部分成功 / 无可用图片。
 * 数量是状态的一部分：请求 4 张只回来 1 张时必须显示“部分成功”，不能
 * 让用户把一次缺图误读成完整交付。
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
  const ratioStyle = { aspectRatio: `${ratioWidth} / ${ratioHeight}` };
  const status = fusionResultStatusOf({
    submitting,
    resultCount: results.length,
    requestedCount,
    failureKind,
  });
  const statusRole =
    status.state === 'failed' || status.state === 'submit_failed' ? 'alert' : 'status';
  const failureHeading =
    status.state === 'timeout'
      ? '结果暂未返回'
      : status.state === 'submit_failed'
        ? '未能提交'
        : '生成失败';
  const failureDetail =
    status.state === 'timeout'
      ? '任务已提交，后台可能仍在生成。请稍后重新查询，或到「我的作品」查看。'
      : status.state === 'submit_failed'
        ? `未能创建生成任务。${lastFailure ? fusionFailureText(lastFailure.errorCode) : '请稍后重试'}`
        : fusionFailureText(lastFailure?.errorCode);

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
            <p>{status.summary} · {ratio}</p>
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

      {submitting && results.length === 0 && !lastFailure ? (
        <div
          className="multi-image-fusion-preview-stage multi-image-fusion-generating-stage"
          style={ratioStyle}
        >
          <ToolGeneratingState tip={`正在生成 ${Math.max(1, requestedCount)} 张融合变体…`} />
        </div>
      ) : lastFailure && results.length === 0 ? (
        <div
          className={`multi-image-fusion-preview-stage ${
            status.state === 'timeout'
              ? 'multi-image-fusion-timeout-stage'
              : 'multi-image-fusion-failure-stage'
          }`}
          style={ratioStyle}
        >
          <div className="multi-image-fusion-result-empty">
            <strong>{failureHeading}</strong>
            <p>{failureDetail}</p>
          </div>
        </div>
      ) : results.length === 0 ? (
        <div className="multi-image-fusion-result-empty" style={ratioStyle}>
          {/* D-84: 参考站是 96x78 三卡片斜叠插画 (-9deg / 0 / +9deg), 非共用插画组件 */}
          <div className="multi-image-fusion-empty-art" aria-hidden>
            <span>
              <ImagePlus size={18} />
            </span>
            <span>
              <Sparkles size={16} />
            </span>
            <span>
              <Layers size={18} />
            </span>
          </div>
          <strong>{EMPTY_TITLE}</strong>
          <p>{EMPTY_HINT}</p>
        </div>
      ) : activeResult?.url ? (
        <>
          {/* D-86: 参考站成功态是棋盘格预览舞台 + 缩略图网格, 不是本地详情卡 */}
          <div
            className="multi-image-fusion-preview-stage"
            style={{
              aspectRatio:
                activeResult.width && activeResult.height
                  ? `${activeResult.width} / ${activeResult.height}`
                  : `${ratioWidth} / ${ratioHeight}`,
            }}
          >
            <img
              className="multi-image-fusion-preview-image"
              src={activeResult.url}
              alt={`多图融合结果 ${activeResultIndex + 1}`}
            />
            {activeResult.width && activeResult.height && (
              <span className="multi-image-fusion-preview-size">
                {activeResult.width}×{activeResult.height}
              </span>
            )}
          </div>
          <div className="multi-image-fusion-thumbnails">
            {results.map((item, index) => (
              <button
                key={item.url ?? index}
                type="button"
                className={index === activeResultIndex ? 'selected' : undefined}
                aria-label={`查看第 ${index + 1} 个融合变体`}
                aria-pressed={index === activeResultIndex}
                onClick={() => onSelectResult(index)}
              >
                <img
                  src={assetThumbUrl(item.url, 240) ?? item.url}
                  alt={`融合结果缩略图 ${index + 1}`}
                  loading="lazy"
                  decoding="async"
                />
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="multi-image-fusion-preview-stage" style={ratioStyle}>
          <div className="multi-image-fusion-result-empty">
            <strong>生成失败</strong>
            <p>模型没有返回可用图片，请重试</p>
          </div>
        </div>
      )}
    </section>
  );
}

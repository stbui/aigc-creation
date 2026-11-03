import { Download, ImagePlus, Layers, RefreshCw, Sparkles } from 'lucide-react';

import { EMPTY_HINT, EMPTY_TITLE } from './constants';
import { ProviderBadge, ToolGeneratingState, type ToolResult } from './components';
import { assetThumbUrl } from './api';

/**
 * 结果面板 —— 变体预览 + 缩略图切换。
 *
 * 四种状态：生成中 / 失败 / 空态 / 成功。
 * 失败与空态都走同一个 `multi-image-fusion-result-empty` 容器，只换文案，
 * 因为参考站这两态的版式一致。
 */
export function MultiFusionResultPanel({
  submitting,
  results,
  activeResult,
  activeResultIndex,
  lastFailure,
  ratio,
  ratioWidth,
  ratioHeight,
  canRegenerate,
  onRegenerate,
  onDownload,
  onSelectResult,
}: {
  submitting: boolean;
  results: ToolResult[];
  activeResult: ToolResult | null;
  activeResultIndex: number;
  lastFailure: ToolResult | null;
  ratio: string;
  ratioWidth: number;
  ratioHeight: number;
  /** 重新生成按钮的禁用判定由页面持有（提交中 / 能力不可用 / 还没有结果） */
  canRegenerate: boolean;
  onRegenerate: () => void;
  onDownload: () => void;
  onSelectResult: (index: number) => void;
}) {
  const ratioStyle = { aspectRatio: `${ratioWidth} / ${ratioHeight}` };
  return (
    <section className="multi-image-fusion-result-panel">
      <div className="multi-image-fusion-result-heading">
        <div>
          <h2>生成结果</h2>
          <p>
            {results.length > 0
              ? `${results.length} 个融合变体 · ${ratio}`
              : '完成设置后，生成结果会显示在这里'}
          </p>
        </div>
        <div className="multi-image-fusion-result-actions">
          <button type="button" disabled={!canRegenerate} onClick={onRegenerate}>
            <RefreshCw size={13} />
            重新生成
          </button>
          <button type="button" disabled={!activeResult?.url} onClick={onDownload}>
            <Download size={13} />
            一键下载
          </button>
        </div>
      </div>

      {submitting && results.length === 0 && !lastFailure ? (
        <div
          className="multi-image-fusion-preview-stage multi-image-fusion-generating-stage"
          style={ratioStyle}
        >
          <ToolGeneratingState />
        </div>
      ) : lastFailure && results.length === 0 ? (
        <div
          className="multi-image-fusion-preview-stage multi-image-fusion-failure-stage"
          style={ratioStyle}
        >
          <div className="multi-image-fusion-result-empty">
            <strong>生成失败</strong>
            <p>{lastFailure.errorCode ?? '未知错误'}</p>
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
            {/* 以 pollToResult 的 provider 为准；新任务恒为模型，历史 local 如实保留 */}
            <ProviderBadge provider={activeResult.provider} className="mif-provider" />
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

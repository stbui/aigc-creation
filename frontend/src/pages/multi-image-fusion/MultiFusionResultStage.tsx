import { ImagePlus, Layers, Sparkles } from 'lucide-react';

import { EMPTY_HINT, EMPTY_TITLE } from './constants';
import { ToolGeneratingState, type ToolResult } from './components';
import { assetThumbUrl } from './api';
import { fusionFailureText, type FusionResultStatus } from './utils';

/**
 * 结果面板的舞台区 —— 按状态渲染五种画面：
 * 生成中 / 失败（提交失败、生成失败、超时） / 空态 / 成功预览 + 缩略图。
 *
 * 状态判定与提交按钮由 `MultiFusionResultPanel` 持有，本组件只负责把
 * `status.state` 映射成对应的画面，不参与任何取数或动作判定。
 */
export function MultiFusionResultStage({
  status,
  submitting,
  results,
  activeResult,
  activeResultIndex,
  lastFailure,
  requestedCount,
  ratioWidth,
  ratioHeight,
  onSelectResult,
}: {
  status: FusionResultStatus;
  submitting: boolean;
  results: ToolResult[];
  activeResult: ToolResult | null;
  activeResultIndex: number;
  lastFailure: ToolResult | null;
  /** 本次提交实际请求的变体数，不随生成后的参数选择变化 */
  requestedCount: number;
  ratioWidth: number;
  ratioHeight: number;
  onSelectResult: (index: number) => void;
}) {
  const ratioStyle = { aspectRatio: `${ratioWidth} / ${ratioHeight}` };
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

  if (submitting && results.length === 0 && !lastFailure) {
    return (
      <div
        className="multi-image-fusion-preview-stage multi-image-fusion-generating-stage"
        style={ratioStyle}
      >
        <ToolGeneratingState tip={`正在生成 ${Math.max(1, requestedCount)} 张融合变体…`} />
      </div>
    );
  }

  if (lastFailure && results.length === 0) {
    return (
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
    );
  }

  if (results.length === 0) {
    return (
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
    );
  }

  if (!activeResult?.url) {
    return (
      <div className="multi-image-fusion-preview-stage" style={ratioStyle}>
        <div className="multi-image-fusion-result-empty">
          <strong>生成失败</strong>
          <p>模型没有返回可用图片，请重试</p>
        </div>
      </div>
    );
  }

  return (
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
  );
}

import { Download, RefreshCw, X } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { taskErrorText } from '../lib/constants';
import { ImageCompare } from './ImageCompare';
import { ProductCardGenerating, ProductCardResult } from './ToolResultCards';
import { ResultMedia, formatDuration } from './ResultMedia';
import { ToolEmptyState, ToolGeneratingState } from './ToolEmptyState';
import type { ToolAsset, ToolResult, ToolResultCompare } from './toolShellTypes';

/**
 * 工具页右栏的「结果三态」。
 *
 * 2026-11-14 从 `ToolShell` 抽出。三态必须分开（2026-10-20 修）：
 * 此前只有「有结果 / 没结果」两态, 而提交任务时 `useToolTask.run` 会先
 * `setResult(null)`, 于是结果栏在生成期间整块退回空态插画, 文案还写着
 * 「提交任务后，生成结果将在此处展示」—— 用户明明已经点了生成, 却看到
 * "你还没提交"。这是**欺骗性 UI**: 慢模型(数秒到数十秒)下尤其刺眼, 用户会
 * 以为按钮没生效而重复点击。现在: 生成中 → 骨架占位; 失败 → 失败卡;
 * 成功 → 结果图; 都没发生 → 空态。
 */
interface Props {
  title: string;
  desc: string;
  emptyDesc: string;
  capability: string;
  submitting: boolean;
  /** 结果数组（已由主壳归一化，空数组表示无结果）。 */
  results: ToolResult[];
  /** 已上传的图片位：`sourcePane` 的函数形态要读它当画布底图。 */
  images: ToolAsset[];
  resultView?: 'default' | 'product-card' | 'canvas';
  generatingAspect?: number;
  resultTag?: string;
  resultBadge?: string;
  resultActions?: ReactNode;
  resultCompare?: ToolResultCompare;
  sourcePane?: ReactNode | ((images: ToolAsset[]) => ReactNode);
  keepSourceWhileSubmitting?: boolean;
  emptyVideo?: string;
  onPreview: (url: string) => void;
  onRegenerate: () => void;
}

export function ToolResultPane({
  title,
  desc,
  emptyDesc,
  capability,
  submitting,
  results,
  images,
  resultView = 'default',
  generatingAspect,
  resultTag,
  resultBadge,
  resultActions,
  resultCompare,
  sourcePane,
  keepSourceWhileSubmitting = false,
  emptyVideo,
  onPreview,
  onRegenerate,
}: Props) {
  const showResult = results.length > 0;

  return (
    <section className="pk-result-pane">
      {submitting && !showResult && !keepSourceWhileSubmitting ? (
        resultView === 'product-card' ? (
          <ProductCardGenerating aspect={generatingAspect} />
        ) : (
          <ToolGeneratingState />
        )
      ) : !showResult ? (
        ((sourcePane ? (typeof sourcePane === 'function' ? sourcePane(images) : sourcePane) : null) ??
        (emptyVideo ? (
          <div className="pk-preview-placeholder">
            <div className="pk-preview-inner">
              <video
                className="image-tool-empty-state-media"
                src={emptyVideo}
                /* 受限浏览器 (无 H.264 解码) 会报 MEDIA_ERR_SRC_NOT_SUPPORTED,
                 留下 480×480 的纯黑块; 首帧 poster 保证此时仍有内容可看。 */
                poster={emptyVideo.replace(/\.mp4$/, '-poster.jpg')}
                autoPlay
                loop
                muted
                playsInline
                aria-label={`${title}演示`}
              />
              <h3>{title}</h3>
              <p>{desc || emptyDesc}</p>
            </div>
          </div>
        ) : (
          <ToolEmptyState title={title} desc={desc || emptyDesc} capability={capability} />
        )))
      ) : resultView === 'product-card' &&
        results.length === 1 &&
        results[0].status === 'succeeded' &&
        results[0].url ? (
        <ProductCardResult
          result={results[0]}
          title={title}
          badge={resultBadge ?? resultTag ?? `${title}结果`}
          fallbackAspect={generatingAspect}
          onPreview={() => onPreview(results[0].url!)}
        />
      ) : resultView === 'canvas' && results.length === 1 && results[0].status === 'succeeded' && results[0].url ? (
        <div className="pk-source-pane redraw-stage redraw-result-stage relative flex flex-1! items-center justify-center gap-0! min-h-0! overflow-hidden! rounded-[var(--radius-panel)] p-0!">
          <div className="redraw-stage-topbar result-actions-only absolute top-0 left-0 z-5 flex min-h-10 w-full items-center justify-center">
            <div className="stage-actions">
              {resultActions}
              <button type="button" disabled={submitting} onClick={onRegenerate}>
                <RefreshCw size={14} />
                重新生成
              </button>
            </div>
          </div>
          <div className="redraw-stage-main absolute inset-0 flex items-center justify-center">
            <div
              className="redraw-canvas-wrap"
              style={
                {
                  '--redraw-image-aspect':
                    generatingAspect ||
                    (results[0].width && results[0].height ? results[0].width / results[0].height : 1),
                } as CSSProperties
              }
            >
              <button
                type="button"
                className="redraw-result-preview"
                aria-label={`预览${title}结果`}
                onClick={() => onPreview(results[0].url!)}
              >
                <ResultMedia
                  url={results[0].url}
                  modality={results[0].modality}
                  alt={`${title}结果`}
                  className="redraw-result-image"
                  priority
                />
              </button>
              <a
                className="redraw-result-download"
                href={results[0].url}
                download
                target="_blank"
                rel="noreferrer"
                aria-label={`下载${title}结果`}
                title="下载"
              >
                <Download size={16} />
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="pk-result-body">
          <div className="pk-result-toolbar">
            <div className="pk-result-title">
              生成结果
              {resultTag && <span className="pk-result-count">{resultTag}</span>}
            </div>
            <div className="tool-result-actions">
              {resultActions}
              <button type="button" className="pk-result-regen" disabled={submitting} onClick={onRegenerate}>
                <RefreshCw size={13} />
                重新生成
              </button>
            </div>
          </div>
          <div className="pk-result-detail-scroll">
            <div className={`tool-result-grid${results.length > 1 ? ' tool-result-grid-multi' : ''}`}>
              {results.map((r, i) =>
                r.status === 'succeeded' && r.url ? (
                  <div key={r.url} className="pk-result-card pk-result-card-detail">
                    <div className="pk-result-detail-media">
                      {resultCompare && results.length === 1 ? (
                        <ImageCompare
                          beforeUrl={resultCompare.beforeUrl}
                          afterUrl={r.url}
                          beforeLabel={resultCompare.beforeLabel}
                          afterLabel={resultCompare.afterLabel}
                        />
                      ) : r.modality === 'video' ? (
                        <ResultMedia url={r.url} modality={r.modality} alt={`${title}结果 ${i + 1}`} />
                      ) : (
                        <button
                          type="button"
                          className="pk-result-preview"
                          aria-label={`预览${title}结果 ${i + 1}`}
                          onClick={() => onPreview(r.url!)}
                        >
                          <ResultMedia url={r.url} modality={r.modality} alt={`${title}结果 ${i + 1}`} />
                        </button>
                      )}
                    </div>
                    <div className="pk-result-meta">
                      <span className="pk-result-variant">{title}结果</span>
                      <span className="pk-result-params">
                        {r.width && r.height ? `${r.width}×${r.height}` : ''}
                        {/* 视频没有宽高可显示 (Jimp 不解视频), 故显示时长 */}
                        {formatDuration(r.durationMs) ? ` · ${formatDuration(r.durationMs)}` : ''}
                      </span>
                    </div>
                    <a className="pk-result-download" href={r.url} download target="_blank" rel="noreferrer">
                      下载原图
                    </a>
                  </div>
                ) : (
                  <div key={`failed-${i}`} className="pk-result-card pk-result-card-detail">
                    <div className="pk-result-detail-media pk-result-failed">
                      <X size={20} />
                      <span>生成失败：{taskErrorText(r.errorCode)}</span>
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

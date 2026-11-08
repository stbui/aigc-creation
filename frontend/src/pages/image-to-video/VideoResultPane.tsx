import { Download, Film, LoaderCircle, TriangleAlert } from 'lucide-react';

import type { ToolAsset, ToolResult } from './components';
import type { CapabilityParam } from './constants';
import { ResultMedia } from './components';
import { VIDEO_DOWNLOAD_NAME } from './constants';
import {
  formatDuration,
  videoConfigSummary,
  videoTaskErrorText,
  type VideoParamValues,
} from './utils';

interface VideoResultPaneProps {
  source: ToolAsset | null;
  result: ToolResult | null;
  submitting: boolean;
  params: readonly CapabilityParam[];
  submittedValues: VideoParamValues;
  currentValues: VideoParamValues;
}

/**
 * 图生视频右侧工作区。
 *
 * 三态必须明确分开：
 * - 未提交：有首帧时展示首帧，没有时展示创作引导；
 * - 生成中：保留视频画幅骨架，明确任务已提交；
 * - 成功/失败：播放真实视频并提供一键下载，或如实展示失败原因。
 *
 * 视频结果必须走共享 `ResultMedia` 的 `<video>` 分支，不能按图片渲染。
 */
export function VideoResultPane({
  source,
  result,
  submitting,
  params,
  submittedValues,
  currentValues,
}: VideoResultPaneProps) {
  const succeeded = result?.status === 'succeeded' && Boolean(result.url);
  const failed = result?.status === 'failed';
  const summary = videoConfigSummary(params, succeeded ? submittedValues : currentValues);
  const duration = formatDuration(result?.durationMs);

  return (
    <section className="pk-result-pane image-to-video-result-pane" aria-label="视频生成结果">
      <div className="image-to-video-result-card">
        <div className="image-to-video-result-head">
          <div>
            <span className="image-to-video-eyebrow">AI VIDEO</span>
            <h2>视频预览</h2>
          </div>
          <span className={`image-to-video-status${succeeded ? ' is-success' : submitting ? ' is-running' : ''}`}>
            {succeeded ? '已生成' : submitting ? '生成中' : failed ? '生成失败' : '待生成'}
          </span>
        </div>

        {submitting && !result ? (
          <div className="image-to-video-generating" aria-live="polite">
            <div className="image-to-video-generating-stage">
              <span className="image-to-video-orbit" aria-hidden />
              <LoaderCircle size={34} className="image-to-video-spinner" />
              <strong>正在生成视频</strong>
              <p>任务已提交，完成后会自动显示在这里。</p>
            </div>
          </div>
        ) : failed ? (
          <div className="image-to-video-failed" role="alert">
            <span className="image-to-video-failed-icon">
              <TriangleAlert size={24} />
            </span>
            <strong>视频生成失败</strong>
            <p>{videoTaskErrorText(result.errorCode)}</p>
            <span>本次失败会自动按平台规则处理积分退款，可直接修改参数后重试。</span>
          </div>
        ) : succeeded && result.url ? (
          <div className="image-to-video-success">
            <div className="image-to-video-video-stage">
              <ResultMedia
                url={result.url}
                modality="video"
                alt="图生视频生成结果"
                className="image-to-video-video"
              />
            </div>
            <div className="image-to-video-result-meta">
              <div className="image-to-video-result-tags">
                <span>
                  <Film size={14} />
                  视频
                </span>
                {summary.map((item) => (
                  <span key={item}>{item}</span>
                ))}
                {duration && <span>{duration}</span>}
              </div>
              <a
                className="image-to-video-download"
                href={result.url}
                download={VIDEO_DOWNLOAD_NAME}
                target="_blank"
                rel="noreferrer"
              >
                <Download size={15} />
                一键下载
              </a>
            </div>
          </div>
        ) : (
          <div className="image-to-video-idle">
            <div className={`image-to-video-idle-visual${source ? ' has-source' : ''}`}>
              {source ? (
                <img src={source.url} alt="图生视频首帧预览" />
              ) : (
                <span className="image-to-video-idle-play" aria-hidden>
                  <Film size={34} />
                </span>
              )}
              <i aria-hidden />
            </div>
            <div className="image-to-video-idle-copy">
              <h3>{source ? '首帧已就绪' : '把静态画面变成动态视频'}</h3>
              <p>
                {source
                  ? '填写动态描述并选择运动幅度、时长与分辨率，生成结果将在这里播放。'
                  : '上传一张图片作为首帧，描述希望画面如何运动，即可生成短视频。'}
              </p>
            </div>
            {summary.length > 0 && (
              <div className="image-to-video-ready-tags">
                {summary.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

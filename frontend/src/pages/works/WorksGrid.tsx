import { Check, Download, Eye, ImageOff, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { assetSrc, assetThumbSrc } from './api';
import { ImageLightbox, ResultMedia, WorkImage, type LightboxItem } from './components';
import {
  capabilityById,
  capabilityName,
  runtimeOf,
  taskErrorText,
  taskModality,
  toolPath,
} from './utils';
import type { Task } from '../../types/api';

/**
 * 我的作品 · 卡片网格与大图查看器。
 *
 * 2026-11-04 从 `page.tsx` 抽出。卡片形态在这里落地：已出图（图片点开查看器 /
 * 视频给原生播放器）与生成中的占位卡。失败任务由服务端和页面侧排除，不进入这里；
 * 生成中的占位卡可删除，但不计入作品数（计数在页面侧）。
 *
 * 大图列表与网格同源：`lightboxItems` 由页面按当前页签 + 筛选结果算好后传入，
 * 因此在大图里按 ←/→ 翻的是用户此刻看到的那一组。
 */

export interface WorksGridProps {
  /** 当前页签下、已按可见数量切片的任务 */
  visible: Task[];
  selected: string[];
  onToggleSelect: (id: string) => void;
  lightboxItems: LightboxItem[];
  previewIndex: number | null;
  setPreviewIndex: (index: number | null) => void;
  retryingId: string | null;
  retryTask: (task: Task) => void;
  downloadWork: (task: Task) => void;
  removeTask: (id: string) => void;
}

export function WorksGrid({
  visible,
  selected,
  onToggleSelect,
  lightboxItems,
  previewIndex,
  setPreviewIndex,
  retryingId,
  retryTask,
  downloadWork,
  removeTask,
}: WorksGridProps) {
  const navigate = useNavigate();
  /** 能力 id → 能力定义（hover 浮层的「再来一张」用） */
  const cardOf = (t: Task) => capabilityById(t.capability);

  return (
    <>
      <div className="my-works-grid">
        {visible.map((t, cardIndex) => {
          const fullUrl = t.outputAsset ? assetSrc(t.outputAsset) : undefined;
          const isSel = selected.includes(t.id);
          const isVideo = taskModality(t) === 'video';
          // 网格只显示缩略图；点开查看器 / 下载仍走完整地址 (lightboxItems / downloadSelected)
          const url = isVideo ? fullUrl : assetThumbSrc(t.outputAsset, 640) ?? fullUrl;
          const def = cardOf(t);
          // 大图列表里的下标: 只有图片作品进查看器, 视频没有可翻的静态原图
          const previewAt = url && !isVideo ? lightboxItems.findIndex((x) => x.id === t.id) : -1;
          return (
            <article key={t.id} className={`my-work-card${isSel ? ' selected' : ''}`}>
              {/*
                图片点开大图查看器; 视频直接给可播放的播放器 (原生控件不能被
                <button> 包住); 「用它再做一张」留在 hover 浮层里。
              */}
              <div
                className={`my-work-media${isVideo ? ' is-video' : ''}${!url ? ' is-placeholder' : ''}`}
              >
                {url ? (
                  isVideo ? (
                    <ResultMedia
                      url={url}
                      modality="video"
                      // 视频没有容器元数据可写, 显式标识只能由播放器侧补 (图片已烙进像素)
                      aigc={t.outputAsset?.aigc}
                      alt={capabilityName(t.capability)}
                    />
                  ) : (
                    <WorkImage
                      src={url}
                      alt={capabilityName(t.capability)}
                      priority={cardIndex < 2}
                      onOpen={() => {
                        if (previewAt >= 0) setPreviewIndex(previewAt);
                      }}
                    />
                  )
                ) : (
                  <span className="my-work-image-placeholder">
                    {t.status === 'failed' ? (
                      <>
                        <ImageOff size={18} />
                        <strong>生成失败</strong>
                        <small>{taskErrorText(t.errorCode)}</small>
                        {def && (
                          <button
                            type="button"
                            className="my-work-placeholder-retry"
                            disabled={retryingId === t.id}
                            title={
                              runtimeOf(def).effective === 'unavailable'
                                ? runtimeOf(def).reason || '该能力暂无可用模型通道'
                                : runtimeOf(def).effective === 'disabled'
                                  ? runtimeOf(def).reason || '该能力已下线'
                                  : '沿用原参数重新生成'
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              retryTask(t);
                            }}
                          >
                            {retryingId === t.id ? (
                              <Loader2 size={12} className="my-work-generating-spinner" />
                            ) : (
                              <RefreshCw size={12} />
                            )}
                            {retryingId === t.id ? '重试中…' : '重试'}
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <Loader2 size={18} className="my-work-generating-spinner" />
                        <strong>生成中</strong>
                        <small>完成后会自动出现在这里</small>
                      </>
                    )}
                  </span>
                )}

                {/*
                  能力名与时间 / 尺寸放在图片下方的脚注里 (见 .my-work-caption),
                  不再用角标 + 深色渐变压在画面上: 缩略图的每个像素都留给产出本身。
                */}
                {/* hover 浮层: 顶部再来一张 / 底部操作。无产出的任务只能删除,
                    不能显示一个实际不会下载任何文件的「下载」。 */}
                <span className={`my-work-hover-actions${url ? '' : ' is-placeholder'}`}>
                  {url && (
                    <span className="my-work-hover-top">
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (def) navigate(toolPath(def.id));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (def) navigate(toolPath(def.id));
                          }
                        }}
                      >
                        <Sparkles size={12} /> 再来一张
                      </span>
                    </span>
                  )}
                  <span className="my-work-hover-bottom">
                    {url && previewAt >= 0 && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => setPreviewIndex(previewAt)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setPreviewIndex(previewAt);
                          }
                        }}
                      >
                        <Eye size={12} /> 查看
                      </span>
                    )}
                    {url && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => downloadWork(t)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            downloadWork(t);
                          }
                        }}
                      >
                        <Download size={12} /> 下载
                      </span>
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      className="is-danger"
                      onClick={() => removeTask(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          removeTask(t.id);
                        }
                      }}
                    >
                      <Trash2 size={12} /> 删除
                    </span>
                  </span>
                </span>
              </div>

              {/* 勾选（多选下载） */}
              {/* 没有产出的生成中任务不能勾选: 下载的是文件, 不能把
                  「任务」当成作品选中, 否则会提示下载 0 个文件。 */}
              {url && (
                <label className="my-work-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => onToggleSelect(t.id)}
                  />
                  <span>{isSel && <Check size={11} />}</span>
                </label>
              )}

              <div className="my-work-caption">
                <span className="my-work-caption-name">{capabilityName(t.capability)}</span>
                <small>
                  {t.createdAt
                    ? new Date(t.createdAt).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })
                    : ''}
                  {t.outputAsset ? ` · ${t.outputAsset.width}×${t.outputAsset.height}` : ''}
                </small>
              </div>
            </article>
          );
        })}
      </div>

      {/* 大图查看器: 与结果栏同一套 (缩放 / 拖拽 / ←→ 翻页 / Esc 关闭) */}
      {previewIndex !== null && lightboxItems[previewIndex] && (
        <ImageLightbox
          items={lightboxItems}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </>
  );
}

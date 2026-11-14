import { assetSrc, assetThumbSrc } from '../lib/api';
import { useNearViewport } from '../hooks/useNearViewport';
import { ResultMedia, modalityOfFormat } from './ResultMedia';
import type { Asset } from '../types/api';
import { Button } from '../ui';

/**
 * 素材库网格中的单张素材卡片。
 *
 * 2026-11-15 从 `AssetLibraryModal` 抽出（原文件内私有组件）：弹窗只负责筛选与
 * 勾选状态，卡片只负责「自己这张要不要现在请求缩略图」。
 *
 * 样式来自 `AssetLibraryModal.css`（`.alp-card` / `.alp-cover` / `.alp-origin-badge`），
 * 由弹窗入口引入；本组件只在该弹窗内渲染，不单独引入以免同一份 CSS 被解析两次。
 *
 * ## 为什么不能直接交给浏览器 `loading="lazy"`
 *
 * 浏览器原生懒加载的预载距离很宽（Chrome 约 1250–3000px）：本弹窗一次拉 120 条、
 * 卡片约 190px 见方，3000px 差不多覆盖**全部**卡片 —— 打开弹窗等于同时请求 120 张
 * 缩略图。后端每张要解码 1–2s（同步占满主线程），于是表现为「格子一直灰着、图慢慢
 * 往外冒」，切换筛选也跟着卡。收紧到 300px 后首屏只请求一屏多一点。
 * 未挂载时渲染占位块，网格高度稳定，不会边加载边跳。
 */
interface Props {
  asset: Asset;
  selected: boolean;
  /** 首屏前几张直连，不等观察器 —— 否则整屏要等一轮 IO 回调才起请求 */
  priority: boolean;
  atLimit: boolean;
  maxSelectable?: number;
  capabilityLabel: (id: string | null | undefined) => string;
  onToggle: (asset: Asset) => void;
}

export function AssetLibraryPickerCard({
  asset,
  selected,
  priority,
  atLimit,
  maxSelectable,
  capabilityLabel,
  onToggle,
}: Props) {
  const [coverRef, near] = useNearViewport<HTMLDivElement>('300px 0px');
  const shouldLoad = priority || near;
  const modality = modalityOfFormat(asset.format);
  // 视频没有缩略图通道, 原样交给 <video>; 图片走方形 JPEG 缩略图
  const previewUrl = (modality === 'video' ? assetSrc(asset) : assetThumbSrc(asset, 480)) ?? '';

  return (
    <Button
      type="text"
      className={`alp-card${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      disabled={!selected && atLimit}
      title={!selected && atLimit ? `最多选择 ${maxSelectable} 张` : undefined}
      onClick={() => onToggle(asset)}
    >
      <div className="alp-cover" ref={coverRef}>
        {shouldLoad ? (
          // 视频素材用 <video> —— 浏览器会把 mp4 当图片解码, 表现为空白缩略图
          <ResultMedia url={previewUrl} modality={modality} alt={asset.sourceUrl} priority={priority} />
        ) : (
          /* 还在等视口: 占位块撑住网格, 顺带告诉用户「在加载」而不是「图坏了」 */
          <span className="alp-cover-placeholder" aria-hidden="true" />
        )}
        {asset.kind === 'original' && (
          <span className="alp-origin-badge is-original" title="用户上传的原始图片">
            用户上传
          </span>
        )}
        {asset.kind === 'generated' && (
          <span className="alp-origin-badge is-generated" title="AI 生成的图片">
            AI 生成
          </span>
        )}
        {asset.capability && (
          <span className="alp-capability" title={`用途：${capabilityLabel(asset.capability)}`}>
            {capabilityLabel(asset.capability)}
          </span>
        )}
        {selected && (
          <span className="alp-check" aria-label="已选择">
            ✓
          </span>
        )}
      </div>
    </Button>
  );
}

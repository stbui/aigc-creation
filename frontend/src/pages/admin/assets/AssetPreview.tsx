import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, Eye, EyeOff, Trash2, X } from 'lucide-react';
import { ImageLightbox, type LightboxItem } from '~/components/ImageLightbox';
import { Button } from '~/ui';
import type { AssetRow } from './constants';
import type { AssetStatus } from '../../../types/api';

/**
 * 素材大图预览。
 *
 * 灯箱里保留「下架 / 删除」两个动作：看图时最常发现违规素材，退回列表再操作
 * 会丢失当前浏览位置。删除仍需二次确认（由页面统一弹条）。
 */
export function AssetPreview({
  assets,
  items,
  index,
  statusBusyId,
  canHide,
  canDelete,
  onIndexChange,
  onClose,
  onToggleStatus,
  onDelete,
}: {
  assets: AssetRow[];
  items: LightboxItem[];
  index: number;
  statusBusyId: string | null;
  canHide: boolean;
  canDelete: boolean;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onToggleStatus: (row: AssetRow, next: AssetStatus) => void;
  onDelete: (row: AssetRow) => void;
}) {
  const asset = assets[index];
  if (!asset) return null;

  const actions = (
    <div className="img-viewer-actions">
      {canHide && (
        <button
          type="button"
          className="img-viewer-action"
          disabled={statusBusyId === asset.id}
          onClick={() => {
            onClose();
            onToggleStatus(asset, asset.status === 'visible' ? 'hidden' : 'visible');
          }}
        >
          {asset.status === 'visible' ? <EyeOff size={14} /> : <Eye size={14} />}
          {asset.status === 'visible' ? '下架' : '恢复'}
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className="img-viewer-action is-danger"
          onClick={() => onDelete(asset)}
        >
          <Trash2 size={14} />
          删除
        </button>
      )}
    </div>
  );

  // 视频不能用 ImageLightbox 的 <img> 预览；单独走原生播放器，保留同一套
  // 翻页、元信息、下载和业务动作，避免运营把视频误判成坏图。
  if (asset.format.startsWith('video/')) {
    return (
      <VideoPreview
        asset={asset}
        items={items}
        index={index}
        actions={actions}
        onIndexChange={onIndexChange}
        onClose={onClose}
      />
    );
  }

  return (
    <ImageLightbox
      items={items}
      index={index}
      onIndexChange={onIndexChange}
      onClose={onClose}
      ariaLabel="素材预览"
      renderActions={() => actions}
    />
  );
}

function VideoPreview({
  asset,
  items,
  index,
  actions,
  onIndexChange,
  onClose,
}: {
  asset: AssetRow;
  items: LightboxItem[];
  index: number;
  actions: React.ReactNode;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[index];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (items.length < 2 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      onIndexChange((index + direction + items.length) % items.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, items.length, onClose, onIndexChange]);

  const go = (direction: -1 | 1) => {
    onIndexChange((index + direction + items.length) % items.length);
  };

  return (
    <div
      className="img-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="素材预览"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Button type="text" className="img-viewer-close" aria-label="关闭预览" onClick={onClose}>
        <X size={20} className="size-[20px]" />
      </Button>

      {items.length > 1 && (
        <>
          <Button
            type="text"
            className="img-viewer-nav is-prev"
            aria-label="上一个视频"
            title="上一个视频（←）"
            onClick={() => go(-1)}
          >
            <ChevronLeft size={22} className="size-[22px]" />
          </Button>
          <Button
            type="text"
            className="img-viewer-nav is-next"
            aria-label="下一个视频"
            title="下一个视频（→）"
            onClick={() => go(1)}
          >
            <ChevronRight size={22} className="size-[22px]" />
          </Button>
        </>
      )}

      <div className="img-viewer-stage is-video">
        <video
          key={asset.id}
          data-viewer-video="1"
          className="img-viewer-video"
          src={item?.url ?? asset.sourceUrl}
          aria-label={item?.alt ?? `${asset.capability ?? '生成'}视频预览`}
          controls
          autoPlay
          muted
          playsInline
          preload="metadata"
        >
          您的浏览器不支持视频播放
        </video>
      </div>

      <div className="img-viewer-bar">
        <span className="img-viewer-meta">{item?.meta?.join(' · ')}</span>
        <a
          className="img-viewer-download"
          href={item?.url ?? asset.sourceUrl}
          download
          target="_blank"
          rel="noreferrer"
          aria-label="下载原视频"
        >
          <Download size={15} />
          <span className="img-viewer-download-text">下载原视频</span>
        </a>
        {actions}
      </div>
    </div>
  );
}

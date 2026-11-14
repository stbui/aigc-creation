import { useCallback } from 'react';
import { assetSrc, assetThumbSrc } from './api';
import {
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuTrigger,
  ResultMedia,
  StatusBadge,
  Surface,
  SurfaceContent,
  cn,
  modalityOfFormat,
} from './components';
import { useApp } from './hooks';
import { useNearViewport } from '../../hooks/useNearViewport';
import { LibraryAssetActions } from './LibraryAssetActions';
import { LibraryAssetMenu } from './LibraryAssetMenu';
import { capabilityName } from './utils';
import type { Asset } from '../../types/api';

/**
 * 素材库网格里的单张卡片。
 *
 * 卡片只保留封面：标题、尺寸、体积等信息不进入卡片，避免挤压图片。
 * 上传原图带常驻角标；查看 / 下载 / 再来一张 / 删除在 hover、键盘聚焦和
 * 触屏环境显示。封面点开时若素材在预览器里，按下标打开整屏查看器。
 *
 * 操作区与右键菜单分别落在 `LibraryAssetActions` / `LibraryAssetMenu`，
 * 本组件只负责封面、选中与懒加载；删除确认走 `useApp().modal`。
 */
export interface LibraryAssetCardProps {
  asset: Asset;
  selected: boolean;
  /** 首屏前 5 张优先加载 */
  priority: boolean;
  /** 在大图查看器中的下标；-1 = 视频或不参与预览 */
  lightboxIndex: number;
  onToggle: (id: string) => void;
  onPreview: (index: number) => void;
  onDownload: (asset: Asset) => void;
  onRemove: (id: string) => void;
  onReuse: (capability: string) => void;
}

export function LibraryAssetCard({
  asset,
  selected,
  priority,
  lightboxIndex,
  onToggle,
  onPreview,
  onDownload,
  onRemove,
  onReuse,
}: LibraryAssetCardProps) {
  const { modal } = useApp();
  const url = assetSrc(asset);
  const isVideo = modalityOfFormat(asset.format) === 'video';
  /*
   * 滚动加载: 卡片接近视口才挂载媒体, 首屏前 5 张 (priority) 直接加载。
   * 未挂载时用素材记录的宽高撑住占位高度, 避免网格加载过程中反复跳动。
   */
  const [coverRef, near] = useNearViewport<HTMLDivElement>();
  const shouldLoad = priority || near;
  const coverRatio =
    asset.width && asset.height ? `${asset.width} / ${asset.height}` : undefined;
  /*
   * 网格只加载缩略图; 视频没有缩略图管线, 直接用原文件 (卡片是懒加载)。
   * 缩略图只限宽、保留原图比例 (preserveAspect), 封面高度随图而异,
   * 网格行内的卡片顶端对齐, 不裁切图片。
   */
  const previewUrl = isVideo ? url : assetThumbSrc(asset, 640, true) ?? url;
  const canPreview = lightboxIndex >= 0;

  /** 整屏查看器：封面点开或右键「查看大图」走这里 */
  const openPreview = () => {
    if (canPreview) onPreview(lightboxIndex);
    else if (url) window.open(url, '_blank', 'noopener');
  };
  /** 「查看」按钮 / 右键「查看原图」：始终打开原图地址（新标签页） */
  const openOriginal = useCallback(() => {
    if (url) window.open(url, '_blank', 'noopener');
  }, [url]);

  const confirmRemove = useCallback(() => {
    void modal.confirm({
      title: '确定删除该素材？',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => onRemove(asset.id),
    });
  }, [asset.id, modal, onRemove]);

  const reuse = useCallback(() => {
    if (asset.capability) onReuse(asset.capability);
  }, [asset.capability, onReuse]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Surface className={cn('asset-library-card', selected && 'is-selected')}>
          <SurfaceContent className="asset-library-card-body p-0">
            <div
              className="asset-library-cover"
              ref={coverRef}
              style={coverRatio ? { aspectRatio: coverRatio } : undefined}
            >
              {shouldLoad && previewUrl && (isVideo ? (
                <ResultMedia
                  url={previewUrl}
                  modality="video"
                  alt={`${capabilityName(asset.capability)} 素材`}
                  priority={priority}
                  aigc={asset.aigc}
                />
              ) : (
                <Button
                  type="text"
                  className="asset-library-cover-button"
                  aria-label={`查看${capabilityName(asset.capability)}素材大图`}
                  title="点击查看大图"
                  onClick={openPreview}
                >
                  <ResultMedia
                    url={previewUrl}
                    modality="image"
                    alt={`${capabilityName(asset.capability)} 素材`}
                    priority={priority}
                  />
                </Button>
              ))}
              {!shouldLoad && <div className="asset-library-cover-placeholder" aria-hidden="true" />}
              <Checkbox
                checked={selected}
                onChange={() => onToggle(asset.id)}
                className={cn('asset-library-check', selected && 'on')}
                aria-label={selected ? '取消选择' : '选择该素材'}
              />
              {asset.kind === 'original' && (
                <StatusBadge variant="secondary" className="asset-library-source-badge">
                  上传原图
                </StatusBadge>
              )}
              <LibraryAssetActions
                canReuse={asset.kind === 'generated' && Boolean(asset.capability)}
                deleteLabel={`删除素材${asset.kind === 'generated' ? '及其作品记录' : ''}`}
                onOpenOriginal={openOriginal}
                onDownload={() => onDownload(asset)}
                onReuse={reuse}
                onRemove={confirmRemove}
              />
            </div>
          </SurfaceContent>
        </Surface>
      </ContextMenuTrigger>

      <LibraryAssetMenu
        canPreview={canPreview}
        onPreview={() => onPreview(lightboxIndex)}
        onOpenOriginal={openOriginal}
        onDownload={() => onDownload(asset)}
        onRemove={confirmRemove}
      />
    </ContextMenu>
  );
}

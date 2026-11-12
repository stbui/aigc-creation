import { useCallback } from 'react';
import { Download, Eye, Sparkles, Trash2 } from 'lucide-react';
import { assetSrc, assetThumbSrc } from './api';
import {
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ResultMedia,
  StatusBadge,
  Surface,
  SurfaceContent,
  cn,
  modalityOfFormat,
} from './components';
import { useApp } from './hooks';
import { capabilityName } from './utils';
import type { Asset } from '../../types/api';

/**
 * 素材库网格里的单张卡片。
 *
 * 卡片只保留封面：标题、尺寸、体积等信息不进入卡片，避免挤压图片。
 * 上传原图带常驻角标；查看 / 下载 / 再来一张 / 删除在 hover、键盘聚焦和
 * 触屏环境显示。封面点开时若素材在预览器里，按下标打开整屏查看器。
 *
 * 右键菜单用 shadcn `ContextMenu`（radix）：查看大图 / 查看原图 / 下载 / 删除，
 * 与 hover 操作区同源，但触屏与精确点选更友好。删除确认走 `useApp().modal`，
 * 不再用浏览器原生 `window.confirm`。
 */
export interface LibraryAssetCardProps {
  asset: Asset;
  selected: boolean;
  /** 首屏前 5 张优先加载 */
  priority: boolean;
  /** 在预览器中的下标；-1 = 视频或不参与预览 */
  previewIndex: number;
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
  previewIndex,
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
   * 网格只加载缩略图; 视频没有缩略图管线, 直接用原文件 (卡片是懒加载)。
   * 缩略图只限宽、保留原图比例 (preserveAspect)，流式布局下卡片高度随图而异，
   * 否则方形缩略图 (?w&h) 会让所有卡片等高，瀑布流退化成普通方格。
   */
  const previewUrl = isVideo ? url : assetThumbSrc(asset, 640, true) ?? url;

  /** 整屏查看器：封面点开或右键「查看大图」走这里 */
  const openPreview = () => {
    if (previewIndex >= 0) onPreview(previewIndex);
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Surface className={cn('asset-library-card', selected && 'is-selected')}>
          <SurfaceContent className="asset-library-card-body p-0">
            <div className="asset-library-cover">
              {previewUrl && (isVideo ? (
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
              <div className="asset-library-hover-actions">
                <Button
                  type="text"
                  size="small"
                  icon={<Eye className="size-3" />}
                  aria-label="查看原图地址"
                  title="查看原图（新标签页打开原图）"
                  onClick={openOriginal}
                >
                  查看
                </Button>
                <Button
                  type="text"
                  size="small"
                  icon={<Download className="size-3" />}
                  aria-label="下载素材"
                  title="下载素材"
                  onClick={() => onDownload(asset)}
                >
                  下载
                </Button>
                {asset.kind === 'generated' && asset.capability && (
                  <Button
                    type="text"
                    size="small"
                    icon={<Sparkles className="size-3" />}
                    onClick={() => onReuse(asset.capability as string)}
                  >
                    再来一张
                  </Button>
                )}
                <Button
                  type="text"
                  size="small"
                  icon={<Trash2 className="size-3" />}
                  className="asset-library-hover-delete"
                  aria-label={`删除素材${asset.kind === 'generated' ? '及其作品记录' : ''}`}
                  title="删除素材"
                  onClick={confirmRemove}
                />
              </div>
            </div>
          </SurfaceContent>
        </Surface>
      </ContextMenuTrigger>

      {/* 右键菜单：查看大图 / 查看原图 / 下载 / 删除 */}
      <ContextMenuContent>
        {previewIndex >= 0 && (
          <ContextMenuItem onSelect={() => onPreview(previewIndex)}>
            <Eye className="size-3.5" />
            查看大图
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={openOriginal}>
          <Eye className="size-3.5" />
          查看原图
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onDownload(asset)}>
          <Download className="size-3.5" />
          下载素材
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={confirmRemove}>
          <Trash2 className="size-3.5" />
          删除素材
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

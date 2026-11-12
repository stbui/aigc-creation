import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { Download, Eye, Sparkles, Trash2 } from 'lucide-react';
import { assetSrc, assetThumbSrc } from './api';
import {
  Button,
  Checkbox,
  ResultMedia,
  StatusBadge,
  Surface,
  SurfaceContent,
  cn,
  modalityOfFormat,
} from './components';
import { capabilityName } from './utils';
import type { Asset } from '../../types/api';

/**
 * 素材库网格里的单张卡片。
 *
 * 卡片只保留封面：标题、尺寸、体积等信息不进入卡片，避免挤压图片。
 * 上传原图带常驻角标；查看 / 下载 / 再来一张 / 删除在 hover、键盘聚焦和
 * 触屏环境显示。封面点开时若素材在预览器里，按下标打开整屏查看器。
 *
 * 右键卡片弹出操作菜单（查看大图 / 查看原图 / 下载 / 删除），与 hover
 * 操作区同源，但触屏与精确点选更友好。
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

/** 右键菜单宽度，用于贴边时回退，避免溢出视口 */
const CTX_MENU_WIDTH = 168;
const CTX_MENU_HEIGHT = 176;

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

  // ── 右键菜单状态 ─────────────────────────────────────────────
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const openMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - CTX_MENU_WIDTH - 8);
    const y = Math.min(e.clientY, window.innerHeight - CTX_MENU_HEIGHT - 8);
    setMenu({ x, y });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  // 菜单打开时，滚动 / 缩放 / 切到别的标签都将其关闭，避免位置错位
  useEffect(() => {
    if (!menu) return;
    const onScroll = () => setMenu(null);
    const onBlur = () => setMenu(null);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('blur', onBlur);
    };
  }, [menu]);

  // Esc 关闭
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const handleRemoveFromMenu = () => {
    setMenu(null);
    if (window.confirm('确定删除该素材？')) onRemove(asset.id);
  };

  return (
    <Surface
      className={cn('asset-library-card', selected && 'is-selected')}
      onContextMenu={openMenu}
    >
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
              onClick={() => {
                if (window.confirm('确定删除该素材？')) onRemove(asset.id);
              }}
            />
          </div>
        </div>
      </SurfaceContent>

      {/* 右键菜单：查看大图 / 查看原图 / 下载 / 删除 */}
      {menu && (
        <>
          <div className="asset-library-ctx-overlay" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
          <div
            className="asset-library-ctx-menu"
            style={{ top: menu.y, left: menu.x }}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {previewIndex >= 0 && (
              <button type="button" className="asset-library-ctx-item" role="menuitem" onClick={() => { setMenu(null); onPreview(previewIndex); }}>
                <Eye className="size-3.5" />
                查看大图
              </button>
            )}
            <button type="button" className="asset-library-ctx-item" role="menuitem" onClick={() => { setMenu(null); openOriginal(); }}>
              <Eye className="size-3.5" />
              查看原图
            </button>
            <button type="button" className="asset-library-ctx-item" role="menuitem" onClick={() => { setMenu(null); onDownload(asset); }}>
              <Download className="size-3.5" />
              下载素材
            </button>
            <button type="button" className="asset-library-ctx-item asset-library-ctx-danger" role="menuitem" onClick={handleRemoveFromMenu}>
              <Trash2 className="size-3.5" />
              删除素材
            </button>
          </div>
        </>
      )}
    </Surface>
  );
}

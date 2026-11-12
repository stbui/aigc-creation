import { Download, Eye, Trash2 } from 'lucide-react';

import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from './components';

/**
 * 素材卡右键菜单：查看大图 / 查看原图 / 下载 / 删除。
 *
 * 触屏与精确点选更友好；删除确认仍由页面侧 `modal.confirm` 承担，这里只转发。
 */
export interface LibraryAssetMenuProps {
  /** 素材是否参与大图查看器（视频不参与） */
  canPreview: boolean;
  onPreview: () => void;
  onOpenOriginal: () => void;
  onDownload: () => void;
  onRemove: () => void;
}

export function LibraryAssetMenu({
  canPreview,
  onPreview,
  onOpenOriginal,
  onDownload,
  onRemove,
}: LibraryAssetMenuProps) {
  return (
    <ContextMenuContent>
      {canPreview && (
        <ContextMenuItem onSelect={onPreview}>
          <Eye className="size-3.5" />
          查看大图
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={onOpenOriginal}>
        <Eye className="size-3.5" />
        查看原图
      </ContextMenuItem>
      <ContextMenuItem onSelect={onDownload}>
        <Download className="size-3.5" />
        下载素材
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={onRemove}>
        <Trash2 className="size-3.5" />
        删除素材
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

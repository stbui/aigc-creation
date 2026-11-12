import { Download, Eye, Sparkles, Trash2 } from 'lucide-react';

import { Button } from './components';

/**
 * 素材卡 hover / 键盘聚焦 / 触屏时的底部操作区。
 *
 * 与右键菜单（`LibraryAssetMenu`）同源，但不完全等价：这里「查看」始终打开
 * 原图地址，而「查看大图」需要素材参与大图查看器（视频不参与）。
 */
export interface LibraryAssetActionsProps {
  canReuse: boolean;
  /** 删除按钮的无障碍文案（生成图会连带删除作品记录） */
  deleteLabel: string;
  onOpenOriginal: () => void;
  onDownload: () => void;
  onReuse: () => void;
  onRemove: () => void;
}

export function LibraryAssetActions({
  canReuse,
  deleteLabel,
  onOpenOriginal,
  onDownload,
  onReuse,
  onRemove,
}: LibraryAssetActionsProps) {
  return (
    <div className="asset-library-hover-actions">
      <Button
        type="text"
        size="small"
        icon={<Eye className="size-3" />}
        aria-label="查看原图地址"
        title="查看原图（新标签页打开原图）"
        onClick={onOpenOriginal}
      >
        查看
      </Button>
      <Button
        type="text"
        size="small"
        icon={<Download className="size-3" />}
        aria-label="下载素材"
        title="下载素材"
        onClick={onDownload}
      >
        下载
      </Button>
      {canReuse && (
        <Button
          type="text"
          size="small"
          icon={<Sparkles className="size-3" />}
          onClick={onReuse}
        >
          再来一张
        </Button>
      )}
      <Button
        type="text"
        size="small"
        icon={<Trash2 className="size-3" />}
        className="asset-library-hover-delete"
        aria-label={deleteLabel}
        title="删除素材"
        onClick={onRemove}
      />
    </div>
  );
}

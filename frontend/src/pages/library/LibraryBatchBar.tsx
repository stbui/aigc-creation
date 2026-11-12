import { Download, FolderInput } from 'lucide-react';

import { Button, Surface, SurfaceContent } from './components';

/**
 * 批量操作条：勾选素材后出现。
 *
 * 只播报选中个数；整条容器不挂 role=status，否则内部按钮会失去按钮语义。
 */

export interface LibraryBatchBarProps {
  count: number;
  onDownload: () => void;
  onMove: () => void;
  onClear: () => void;
}

export function LibraryBatchBar({ count, onDownload, onMove, onClear }: LibraryBatchBarProps) {
  return (
    <Surface className="asset-library-batch-bar flex-row gap-3 py-0">
      <SurfaceContent className="flex flex-wrap items-center gap-3 p-0">
        {/* 只播报选中个数；整条容器挂 role=status 会让内部按钮失去按钮语义 */}
        <span aria-live="polite">已选 {count} 个素材</span>
        <Button
          type="text"
          size="small"
          icon={<Download className="size-3" />}
          onClick={onDownload}
        >
          下载所选
        </Button>
        <Button
          type="text"
          size="small"
          icon={<FolderInput className="size-3" />}
          onClick={onMove}
        >
          移动到项目
        </Button>
        <Button
          type="text"
          size="small"
          className="asset-library-batch-cancel"
          onClick={onClear}
        >
          取消选择
        </Button>
      </SurfaceContent>
    </Surface>
  );
}

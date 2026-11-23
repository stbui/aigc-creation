import { Download, FolderInput } from 'lucide-react';

import { Button, Card, CardContent } from './components';

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
    <Card className="mb-3.5 flex-row gap-3 rounded-lg bg-brand-bg px-3.5 py-2.5 text-xs text-brand-hover">
      <CardContent className="flex flex-wrap items-center gap-3 p-0">
        {/* 只播报选中个数；整条容器挂 role=status 会让内部按钮失去按钮语义 */}
        <span aria-live="polite">已选 {count} 个素材</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-brand"
          onClick={onDownload}
        >
          {<Download className="size-3" />}
          下载所选
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-brand"
          onClick={onMove}
        >
          {<FolderInput className="size-3" />}
          移动到项目
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-inherit hover:bg-transparent"
          onClick={onClear}
        >
          取消选择
        </Button>
      </CardContent>
    </Card>
  );
}

import { Download, Eye, Sparkles, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from './components';

/** 悬浮操作按钮的统一皮肤：深色玻璃底 + 白字，按 31px 高度排一行。 */
const ACTION_CLASS =
  'inline-flex h-[31px] flex-1 items-center justify-center gap-1 rounded-md border border-white/55 bg-[rgba(24,29,52,0.77)] px-1.5 text-xs text-card backdrop-blur-sm hover:bg-[rgba(78,64,207,0.9)]';

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
  /** 「再来一张」的目标工具页；有可复用能力时传入 */
  reuseTo?: string;
  onRemove: () => void;
}

export function LibraryAssetActions({
  canReuse,
  deleteLabel,
  onOpenOriginal,
  onDownload,
  reuseTo,
  onRemove,
}: LibraryAssetActionsProps) {
  return (
    <div className="absolute inset-x-2.5 bottom-2.5 z-[4] flex gap-[7px] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
      <Button
        variant="ghost"
        size="sm"
        className={ACTION_CLASS}
        aria-label="查看原图地址"
        title="查看原图（新标签页打开原图）"
        onClick={onOpenOriginal}
      >
        {<Eye className="size-3" />}
        查看
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={ACTION_CLASS}
        aria-label="下载素材"
        title="下载素材"
        onClick={onDownload}
      >
        {<Download className="size-3" />}
        下载
      </Button>
      {canReuse && reuseTo && (
        <Button asChild variant="ghost" size="sm" className={ACTION_CLASS}>
          <Link to={reuseTo}>
            <Sparkles className="size-3" aria-hidden />
            再来一张
          </Link>
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className={`${ACTION_CLASS} flex-none basis-[31px] px-0`}
        aria-label={deleteLabel}
        title="删除素材"
        onClick={onRemove}>
          {<Trash2 className="size-3" />}</Button>
    </div>
  );
}

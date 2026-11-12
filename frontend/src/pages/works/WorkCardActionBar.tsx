import { Download, Eye, Sparkles, Trash2 } from 'lucide-react';

import { WorkCardAction } from './WorkCardAction';

/**
 * 作品卡 hover / 聚焦浮层：顶部「再来一张」，底部查看 / 下载 / 删除。
 *
 * 无产出的任务只能删除 —— 不显示一个实际不会下载任何文件的「下载」。
 */
export interface WorkCardActionBarProps {
  canReuse: boolean;
  canPreview: boolean;
  canDownload: boolean;
  onReuse: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onRemove: () => void;
}

export function WorkCardActionBar({
  canReuse,
  canPreview,
  canDownload,
  onReuse,
  onPreview,
  onDownload,
  onRemove,
}: WorkCardActionBarProps) {
  return (
    <span className={`my-work-hover-actions${canDownload ? '' : ' is-placeholder'}`}>
      {canReuse && (
        <span className="my-work-hover-top">
          <WorkCardAction onActivate={onReuse}>
            <Sparkles size={12} /> 再来一张
          </WorkCardAction>
        </span>
      )}
      <span className="my-work-hover-bottom">
        {canPreview && (
          <WorkCardAction onActivate={onPreview}>
            <Eye size={12} /> 查看
          </WorkCardAction>
        )}
        {canDownload && (
          <WorkCardAction onActivate={onDownload}>
            <Download size={12} /> 下载
          </WorkCardAction>
        )}
        <WorkCardAction danger onActivate={onRemove}>
          <Trash2 size={12} /> 删除
        </WorkCardAction>
      </span>
    </span>
  );
}

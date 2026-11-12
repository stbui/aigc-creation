import { Download } from 'lucide-react';

/** 多选操作条：选中任一卡片后出现 */
export interface WorksSelectionBarProps {
  selectedCount: number;
  /** 已勾选且已出图的数量：为 0 时下载按钮禁用 */
  downloadableCount: number;
  onDownload: () => void;
  onClear: () => void;
}

export function WorksSelectionBar({
  selectedCount,
  downloadableCount,
  onDownload,
  onClear,
}: WorksSelectionBarProps) {
  return (
    <div className="my-works-selection-bar">
      <span>已选 {selectedCount} 个作品</span>
      <button type="button" disabled={downloadableCount === 0} onClick={onDownload}>
        <Download size={11} /> 下载所选
      </button>
      <button type="button" className="my-works-selection-exit" onClick={onClear}>
        取消选择
      </button>
    </div>
  );
}

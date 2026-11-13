import type { AnnotationDraft, RegionBounds } from './constants';
import { ToolCard } from './components';
import { LocalRedrawAnnotationItem } from './LocalRedrawAnnotationItem';

interface LocalRedrawAnnotationPanelProps {
  regions: RegionBounds[];
  drafts: Record<number, AnnotationDraft>;
  /** 已填写描述的区域数；与 regions 一起显示进度 */
  filledCount: number;
  /** 参考图上传期间禁止删除 */
  uploadBusy: boolean;
  referenceUploading: Set<number>;
  onRemove: (id: number) => void;
  onDraftChange: (id: number, patch: Partial<AnnotationDraft>) => void;
  onUploadReference: (id: number, file: File | undefined) => void;
}

/**
 * 重绘描述面板：按画布上的有效区域逐条填写描述与参考图。
 *
 * 区域来自画布回调（`regions`），本组件不自行增删；删除动作回到页面，
 * 由页面同时通知画布按稳定 id 移除区域。
 */
export function LocalRedrawAnnotationPanel({
  regions,
  drafts,
  filledCount,
  uploadBusy,
  referenceUploading,
  onRemove,
  onDraftChange,
  onUploadReference,
}: LocalRedrawAnnotationPanelProps) {
  return (
    <ToolCard
      title={
        <>
          <i className="pk-required-mark u-font-14">*</i>重绘描述
        </>
      }
      actions={
        <span>
          {filledCount}/{regions.length}
        </span>
      }
      className="prompt-card"
    >
      {regions.length === 0 ? (
        <div className="redraw-prompt is-pending">
          <label className="redraw-prompt-label is-pending">
            <i />
            标注1
          </label>
          <textarea rows={2} value="" disabled placeholder="请先在图片上标注区域..." />
        </div>
      ) : (
        regions.map((region, index) => (
          <LocalRedrawAnnotationItem
            key={region.id}
            region={region}
            index={index}
            draft={drafts[region.id]}
            removeDisabled={uploadBusy}
            uploading={referenceUploading.has(region.id)}
            onRemove={onRemove}
            onDraftChange={onDraftChange}
            onUploadReference={onUploadReference}
          />
        ))
      )}
    </ToolCard>
  );
}

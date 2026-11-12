import { Plus, X } from 'lucide-react';

import type { AnnotationDraft, RegionBounds } from './constants';
import { assetThumbUrl } from './api';

const MAX_PROMPT_LEN = 200;

interface LocalRedrawAnnotationItemProps {
  region: RegionBounds;
  index: number;
  draft: AnnotationDraft | undefined;
  /** 参考图上传期间禁止删除标注 */
  removeDisabled: boolean;
  /** 该区域参考图正在上传 */
  uploading: boolean;
  onRemove: (id: number) => void;
  onDraftChange: (id: number, patch: Partial<AnnotationDraft>) => void;
  onUploadReference: (id: number, file: File | undefined) => void;
}

/** 单个标注区域：编号、重绘描述与可选参考图上传。 */
export function LocalRedrawAnnotationItem({
  region,
  index,
  draft,
  removeDisabled,
  uploading,
  onRemove,
  onDraftChange,
  onUploadReference,
}: LocalRedrawAnnotationItemProps) {
  const label = `标注${index + 1}`;
  const reference = draft?.reference ?? null;

  return (
    <div className="redraw-prompt">
      <button
        type="button"
        className="remove-annotation"
        aria-label={`删除${label}`}
        title={`删除${label}`}
        disabled={removeDisabled}
        onClick={() => onRemove(region.id)}
      >
        <X size={13} />
      </button>
      <label className="redraw-prompt-label is-marked">
        <i />
        {label}
      </label>
      <textarea
        rows={2}
        maxLength={MAX_PROMPT_LEN}
        value={draft?.prompt ?? ''}
        placeholder="请输入您要重绘的内容，例如：更换颜色..."
        onChange={(event) => onDraftChange(region.id, { prompt: event.target.value })}
      />
      <label
        className={`redraw-prompt-tools reference-upload${reference ? ' has-image' : ''}`}
        title={reference ? `替换${label}参考图` : `上传${label}参考图`}
      >
        {reference && (
          <>
            <img src={assetThumbUrl(reference.url, 240) ?? reference.url} alt={`${label}参考图`} />
            <button
              type="button"
              className="remove-reference"
              aria-label={`移除${label}参考图`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDraftChange(region.id, { reference: null });
              }}
            >
              <X size={12} />
            </button>
          </>
        )}
        {uploading && !reference ? (
          <span>上传中…</span>
        ) : !reference ? (
          <>
            <Plus size={16} />
            <span>上传图片</span>
          </>
        ) : null}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          disabled={uploading}
          onChange={(event) => {
            onUploadReference(region.id, event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

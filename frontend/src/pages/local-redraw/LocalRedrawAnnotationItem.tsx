import { Plus, X } from 'lucide-react';

import type { AnnotationDraft, RegionBounds } from './constants';
import {
  ANNOTATION_CARD,
  ANNOTATION_LABEL,
  ANNOTATION_REFERENCE,
  ANNOTATION_REFERENCE_FILLED,
  ANNOTATION_REFERENCE_REMOVE,
  ANNOTATION_TEXTAREA,
  SUPPORTED_IMAGE_ACCEPT,
} from './constants';
import { assetThumbUrl } from './api';
import { ImageUploadArea } from './components';

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
    <div className={`redraw-prompt ${ANNOTATION_CARD}`}>
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
      <label className={`redraw-prompt-label is-marked ${ANNOTATION_LABEL}`}>
        <i />
        {label}
      </label>
      <textarea
        className={ANNOTATION_TEXTAREA}
        rows={2}
        maxLength={MAX_PROMPT_LEN}
        value={draft?.prompt ?? ''}
        placeholder="请输入您要重绘的内容，例如：更换颜色..."
        onChange={(event) => onDraftChange(region.id, { prompt: event.target.value })}
      />
      <ImageUploadArea
        variant="plain"
        max={1}
        single
        uploading={uploading}
        disabled={uploading}
        accept={SUPPORTED_IMAGE_ACCEPT}
        replaceOnClick
        className={`redraw-prompt-tools ${ANNOTATION_REFERENCE}${
          reference ? ` ${ANNOTATION_REFERENCE_FILLED}` : ''
        }`}
        ariaLabel={reference ? `替换${label}参考图` : `上传${label}参考图`}
        title={reference ? `替换${label}参考图` : `上传${label}参考图`}
        images={
          reference
            ? [
                {
                  ...reference,
                  thumbUrl: assetThumbUrl(reference.url, 240) ?? reference.url,
                },
              ]
            : []
        }
        emptyContent={() =>
          uploading && !reference ? (
            <span>上传中…</span>
          ) : (
            <>
              <Plus size={16} aria-hidden />
              <span>上传图片</span>
            </>
          )
        }
        renderPreview={(items) => {
          const image = items[0];
          if (!image) return null;
          return (
            <>
              <img
                className="block size-full object-cover"
                src={image.thumbUrl ?? image.url}
                alt={`${label}参考图`}
              />
              <button
                type="button"
                className={`remove-reference ${ANNOTATION_REFERENCE_REMOVE}`}
                aria-label={`移除${label}参考图`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDraftChange(region.id, { reference: null });
                }}
              >
                <X size={12} aria-hidden />
              </button>
            </>
          );
        }}
        onFiles={(files) => onUploadReference(region.id, Array.from(files)[0])}
      />
    </div>
  );
}

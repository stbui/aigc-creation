import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';

import {
  MAX_ACCENTS,
  MAX_TOTAL,
  SUPPORTED_IMAGE_ACCEPT,
  UPLOAD_SUBJECT_HINT,
  type MultiFusionSlot,
} from './constants';
import type { ToolAsset } from './components';
import { MultiFusionImageThumb } from './MultiFusionImageThumb';
import { MultiFusionSlotActions } from './MultiFusionSlotActions';

/**
 * 上传卡 —— 主体图（1 张）+ 搭配图（1-5 张）两个图位。
 *
 * 两个图位各有两个补图入口：素材库导入与手机上传；拖拽与粘贴也落到对应图位。
 * 文件选择框由本组件自持（隐藏 input），页面只关心「拿到文件」。
 */
export function MultiFusionUploadCard({
  subject,
  accents,
  uploading,
  totalCount,
  onUploadFiles,
  onRemoveSubject,
  onRemoveAccent,
  onOpenLibrary,
  onOpenMobile,
}: {
  subject: ToolAsset | null;
  accents: ToolAsset[];
  uploading: boolean;
  totalCount: number;
  /** 拿到文件后由页面统一走校验 + 上传 */
  onUploadFiles: (target: MultiFusionSlot, files: FileList | File[]) => void;
  onRemoveSubject: () => void;
  onRemoveAccent: (id: string) => void;
  onOpenLibrary: (target: MultiFusionSlot) => void;
  onOpenMobile: (target: MultiFusionSlot) => void;
}) {
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const accentInputRef = useRef<HTMLInputElement>(null);
  // 两个图位各自维护拖拽态：拖到主体位不该连带高亮搭配位
  const [subjectDragging, setSubjectDragging] = useState(false);
  const [accentDragging, setAccentDragging] = useState(false);
  /**
   * 参考站搭配图空态只有一个添加入口，槽内文案明确剩余额度。
   * 已满 5 张时不再渲染添加入口。
   */
  const accentRoom = Math.max(0, MAX_ACCENTS - accents.length);

  return (
    <div className="multi-image-fusion-card multi-image-fusion-upload-card">
      <div className="multi-image-fusion-card-heading">
        <div>
          <h2>上传图片</h2>
        </div>
        {/* D-22: 参考站是 11px 弱化灰 #aeacbd, 不是 16px 深色强调 */}
        <span className="multi-image-fusion-count">
          {totalCount} / {MAX_TOTAL}
        </span>
      </div>

      {/* 主体图: 必传 1 张 */}
      <div className="multi-image-fusion-upload-section">
        <div className="multi-image-fusion-field-label">
          <span>主体图</span>
          <small>必传 · 1 张</small>
          <MultiFusionSlotActions
            target="subject"
            onOpenLibrary={onOpenLibrary}
            onOpenMobile={onOpenMobile}
          />
        </div>
        {subject ? (
          <MultiFusionImageThumb
            asset={subject}
            uploading={uploading}
            removeLabel="移除主体图"
            onRemove={onRemoveSubject}
          />
        ) : (
          <button
            type="button"
            className={`multi-image-fusion-upload-empty${subjectDragging ? ' is-dragging' : ''}`}
            onClick={() => subjectInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setSubjectDragging(true);
            }}
            onDragLeave={() => setSubjectDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setSubjectDragging(false);
              if (e.dataTransfer.files.length) onUploadFiles('subject', e.dataTransfer.files);
            }}
          >
            {/* D-31: 参考站有 36x36 圆角色块, 本地原先没有 */}
            <span className="multi-image-fusion-upload-icon">
              <ImagePlus size={18} />
            </span>
            <strong>上传主体图</strong>
            <span>{UPLOAD_SUBJECT_HINT}</span>
          </button>
        )}
      </div>

      {/* 搭配图: 必传 1-5 张, 参考站是网格小槽 (S-8) */}
      <div className="multi-image-fusion-upload-section">
        <div className="multi-image-fusion-field-label">
          <span>搭配图</span>
          <small>必传 · 1-5 张</small>
          <MultiFusionSlotActions
            target="accent"
            onOpenLibrary={onOpenLibrary}
            onOpenMobile={onOpenMobile}
          />
        </div>
        <div
          className={`multi-image-fusion-accessory-grid${accentDragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setAccentDragging(true);
          }}
          onDragLeave={() => setAccentDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setAccentDragging(false);
            if (e.dataTransfer.files.length) onUploadFiles('accent', e.dataTransfer.files);
          }}
        >
          {accents.map((a) => (
            <MultiFusionImageThumb
              key={a.id}
              asset={a}
              uploading={uploading}
              removeLabel={`移除 ${a.name}`}
              onRemove={() => onRemoveAccent(a.id)}
            />
          ))}
          {/* 参考站空态只有一个添加入口，并在槽内写明剩余额度 */}
          {accentRoom > 0 && (
            <button
              type="button"
              className="multi-image-fusion-upload-empty"
              aria-label={`添加搭配图，还可添加 ${accentRoom} 张`}
              onClick={() => accentInputRef.current?.click()}
            >
              <span className="multi-image-fusion-upload-icon">
                <ImagePlus size={18} />
              </span>
              <strong>添加搭配图</strong>
              <span>还可添加 {accentRoom} 张</span>
            </button>
          )}
        </div>
      </div>

      {/* 文件选择框: 主体位单选, 搭配位多选 */}
      <input
        ref={subjectInputRef}
        type="file"
        accept={SUPPORTED_IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          if (e.target.files) onUploadFiles('subject', e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={accentInputRef}
        type="file"
        accept={SUPPORTED_IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onUploadFiles('accent', e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

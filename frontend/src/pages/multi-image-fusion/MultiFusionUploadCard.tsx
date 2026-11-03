import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';

import {
  MAX_ACCENTS,
  MAX_TOTAL,
  SUPPORTED_IMAGE_ACCEPT,
  UPLOAD_SUBJECT_HINT,
} from './constants';
import type { ToolAsset } from './components';
import { assetThumbUrl } from './api';

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
  onUploadFiles: (target: 'subject' | 'accent', files: FileList | File[]) => void;
  onRemoveSubject: () => void;
  onRemoveAccent: (id: string) => void;
  onOpenLibrary: (target: 'subject' | 'accent') => void;
  onOpenMobile: (target: 'subject' | 'accent') => void;
}) {
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const accentInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
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
          <span className="multi-image-fusion-field-actions">
            <button
              type="button"
              className="multi-image-fusion-field-link"
              title="从已上传的素材里选一张作为主体图"
              onClick={() => onOpenLibrary('subject')}
            >
              从素材库导入
            </button>
            <button
              type="button"
              className="multi-image-fusion-field-link multi-image-fusion-mobile-upload-link"
              title="扫码在手机上选择图片，接收后进入主体图位"
              onClick={() => onOpenMobile('subject')}
            >
              手机上传
            </button>
          </span>
        </div>
        {subject ? (
          <div className="multi-image-fusion-image-card">
            <img
              src={assetThumbUrl(subject.url, 320) ?? subject.url}
              alt={subject.name}
              loading="lazy"
              decoding="async"
            />
            <button
              type="button"
              className="multi-image-fusion-remove"
              aria-label="移除主体图"
              onClick={onRemoveSubject}
            >
              <X size={12} />
            </button>
            {uploading && <span className="multi-image-fusion-uploading">上传中</span>}
          </div>
        ) : (
          <button
            type="button"
            className="multi-image-fusion-upload-empty"
            onClick={() => subjectInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
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
          <span className="multi-image-fusion-field-actions">
            <button
              type="button"
              className="multi-image-fusion-field-link"
              title="从已上传的素材里挑选搭配图"
              onClick={() => onOpenLibrary('accent')}
            >
              从素材库导入
            </button>
            <button
              type="button"
              className="multi-image-fusion-field-link multi-image-fusion-mobile-upload-link"
              title="扫码在手机上选择图片，接收后进入搭配图位"
              onClick={() => onOpenMobile('accent')}
            >
              手机上传
            </button>
          </span>
        </div>
        <div
          className={`multi-image-fusion-accessory-grid${dragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) onUploadFiles('accent', e.dataTransfer.files);
          }}
        >
          {accents.map((a) => (
            <div key={a.id} className="multi-image-fusion-image-card">
              <img
                src={assetThumbUrl(a.url, 320) ?? a.url}
                alt={a.name}
                loading="lazy"
                decoding="async"
              />
              <button
                type="button"
                className="multi-image-fusion-remove"
                aria-label={`移除 ${a.name}`}
                onClick={() => onRemoveAccent(a.id)}
              >
                <X size={12} />
              </button>
              {uploading && <span className="multi-image-fusion-uploading">上传中</span>}
            </div>
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

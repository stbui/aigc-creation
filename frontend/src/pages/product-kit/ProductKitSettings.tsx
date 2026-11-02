import type { RefObject } from 'react';
import { Maximize2, Sparkles } from 'lucide-react';

import {
  MAX_DESC_LEN,
  MAX_IMAGE_MB,
  MAX_IMAGES,
  MAX_NAME_LEN,
} from './constants';
import { ToolImageDropzone } from './components';
import type { UploadedImage } from './hooks';
import { languageOptions, platformOptions } from './utils';
import { Input, Select } from '../../ui';

/**
 * 生成设置卡：上传商品图 + 名称/品牌/平台/语言 + 商品描述。
 *
 * 上传、AI 分析与放大编辑的状态都在 `page.tsx`，这里只负责表单展示与事件转发，
 * 避免把「提交/扣费」逻辑带进展示组件。
 */
export function ProductKitSettings({
  images,
  uploading,
  fileInputRef,
  onFiles,
  onRemove,
  onOpenLibrary,
  onOpenMobile,
  productName,
  onProductNameChange,
  brand,
  onBrandChange,
  platform,
  onPlatformChange,
  language,
  onLanguageChange,
  description,
  onDescriptionChange,
  analyzing,
  onAnalyze,
  onExpandDescription,
}: {
  images: UploadedImage[];
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
  productName: string;
  onProductNameChange: (value: string) => void;
  brand: string;
  onBrandChange: (value: string) => void;
  platform: string;
  onPlatformChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  analyzing: boolean;
  onAnalyze: () => void;
  onExpandDescription: () => void;
}) {
  return (
    <section className="pk-config-card">
      <ToolImageDropzone
        title="上传商品图"
        images={images}
        max={MAX_IMAGES}
        maxMb={MAX_IMAGE_MB}
        uploading={uploading}
        fileInputRef={fileInputRef}
        onFiles={onFiles}
        onRemove={onRemove}
        onOpenLibrary={onOpenLibrary}
        onOpenMobile={onOpenMobile}
        noun="商品图片"
      />

      <div className="pk-section">
        <strong className="pk-section-title">
          <i className="pk-required-mark">*</i>生成设置
        </strong>
        <div className="pk-form-grid">
          <label className="pk-field">
            <span className="pk-field-label">
              <i className="pk-required-mark">*</i>商品名称
            </span>
            <Input
              value={productName}
              maxLength={MAX_NAME_LEN}
              placeholder="* 请输入商品名称"
              onChange={(e) => onProductNameChange(e.target.value)}
            />
          </label>
          <label className="pk-field">
            <span className="pk-field-label">品牌（选填）</span>
            <Input
              value={brand}
              maxLength={MAX_NAME_LEN}
              placeholder="请输入品牌（选填）"
              onChange={(e) => onBrandChange(e.target.value)}
            />
          </label>
          {/* Select 不用 <label> 包裹: label 会把点击转发给内部 input,
              已知会让下拉"打开即关闭"; 无障碍名走 aria-label */}
          <div className="pk-field">
            <span className="pk-field-label">平台</span>
            <Select
              value={platform}
              onChange={onPlatformChange}
              options={platformOptions().map((o) => ({ value: o.value, label: o.label }))}
              aria-label="平台"
            />
          </div>
          <div className="pk-field">
            <span className="pk-field-label">语言</span>
            <Select
              value={language}
              onChange={onLanguageChange}
              options={languageOptions().map((o) => ({ value: o.value, label: o.label }))}
              aria-label="语言"
            />
          </div>
        </div>
      </div>

      <div className="pk-section">
        <div className="pk-field-label-row">
          <span className="pk-section-title">
            <i className="pk-required-mark">*</i>商品描述
          </span>
          <div className="pk-desc-actions">
            <button
              type="button"
              className="pk-ai-btn"
              disabled={analyzing}
              onClick={onAnalyze}
            >
              <Sparkles size={12} />
              <span>{analyzing ? '分析中…' : 'AI分析'}</span>
            </button>
          </div>
        </div>
        <div className="pk-desc-editor">
          <textarea
            rows={3}
            maxLength={MAX_DESC_LEN}
            value={description}
            placeholder="* 请输入商品描述"
            onChange={(e) => onDescriptionChange(e.target.value)}
          />
          <button
            type="button"
            className="pk-desc-expand"
            aria-label="放大编辑商品描述"
            title="放大编辑"
            onClick={onExpandDescription}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}

import type { ReactNode, RefObject } from 'react';
import { Maximize2, Sparkles } from 'lucide-react';

import { ToolImageDropzone } from './ToolImageDropzone';
import { MAX_PRODUCT_NAME_LEN } from '../lib/constants';
import { languageOptions, platformOptions } from '../lib/optionSets';
import type { UploadedImage } from '../hooks/useImageUpload';
import { Input, Select, Textarea } from '../ui';

export interface ProductFieldsGridProps {
  productName: string;
  onProductNameChange: (value: string) => void;
  brand: string;
  onBrandChange: (value: string) => void;
  platform: string;
  onPlatformChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  /** 必填星号与占位文案；爆款复刻的名称 / 品牌均为选填 */
  required?: boolean;
  /** 是否渲染「生成设置」小标题；外层已有标题时传 false */
  showTitle?: boolean;
}

/**
 * 商品基础字段：名称 / 品牌 / 平台 / 语言。
 *
 * 商品主图、商品详情、爆款复刻三页共用同一套 `.pk-field` 结构，
 * 避免同一组字段在三个页面各写一份并与选项集漂移。
 */
export function ProductFieldsGrid({
  productName,
  onProductNameChange,
  brand,
  onBrandChange,
  platform,
  onPlatformChange,
  language,
  onLanguageChange,
  required = true,
  showTitle = true,
}: ProductFieldsGridProps) {
  const mark = required ? <i className="pk-required-mark u-font-14">*</i> : null;
  return (
    <div className="pk-section">
      {showTitle && <strong className="pk-section-title u-font-14">{mark}生成设置</strong>}
      <div className="pk-form-grid">
        <label className="pk-field">
          <span className="pk-field-label">{mark}商品名称</span>
          <Input
            value={productName}
            maxLength={MAX_PRODUCT_NAME_LEN}
            placeholder={required ? '* 请输入商品名称' : '请输入商品名称'}
            onChange={(event) => onProductNameChange(event.target.value)}
          />
        </label>
        <label className="pk-field">
          <span className="pk-field-label">品牌（选填）</span>
          <Input
            value={brand}
            maxLength={MAX_PRODUCT_NAME_LEN}
            placeholder={required ? '请输入品牌（选填）' : '请输入品牌'}
            onChange={(event) => onBrandChange(event.target.value)}
          />
        </label>
        <SelectField label="平台" value={platform} options={platformOptions()} onChange={onPlatformChange} />
        <SelectField label="语言" value={language} options={languageOptions()} onChange={onLanguageChange} />
      </div>
    </div>
  );
}

/** 「标签 + 下拉」原子字段；Select 不用 <label> 包裹，避免点击转发导致打开即关闭 */
export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string | number; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="pk-field">
      <span className="pk-field-label">{label}</span>
      <Select
        value={value}
        onChange={(next) => onChange(String(next))}
        options={options}
        aria-label={label}
      />
    </div>
  );
}

export interface ProductDescriptionFieldProps {
  value: string;
  onChange: (value: string) => void;
  analyzing: boolean;
  onAnalyze: () => void;
  onExpand: () => void;
  maxLength: number;
  rows?: number;
}

/** 商品描述：AI 分析 + 文本域 + 放大编辑入口 */
export function ProductDescriptionField({
  value,
  onChange,
  analyzing,
  onAnalyze,
  onExpand,
  maxLength,
  rows = 3,
}: ProductDescriptionFieldProps) {
  return (
    <div className="pk-section">
      <div className="pk-field-label-row">
        <span className="pk-section-title u-font-14">
          <i className="pk-required-mark u-font-14">*</i>商品描述
        </span>
        <div className="pk-desc-actions">
          <button type="button" className="pk-ai-btn u-font-12 u-py-4 u-px-10" disabled={analyzing} onClick={onAnalyze}>
            <Sparkles size={12} />
            <span>{analyzing ? '分析中…' : 'AI分析'}</span>
          </button>
        </div>
      </div>
      <div className={`pk-desc-editor${rows >= 5 ? ' pk-desc-editor-tall' : ''}`}>
        <Textarea
          rows={rows}
          maxLength={maxLength}
          value={value}
          placeholder="* 请输入商品描述"
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="pk-desc-expand"
          aria-label="放大编辑商品描述"
          title="放大编辑"
          onClick={onExpand}
        >
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  );
}

export interface ProductImageFieldProps {
  images: UploadedImage[];
  /** 当前模型能力合同允许的图片数（已与页面上限取较小值） */
  max: number;
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
  /** 已选素材超过模型上限时的可读原因 */
  limitError?: string | null;
  title?: string;
  noun?: string;
}

/** 商品图上传位：上传区 + 模型上限提示 */
export function ProductImageField({
  images,
  max,
  uploading,
  fileInputRef,
  onFiles,
  onRemove,
  onOpenLibrary,
  onOpenMobile,
  limitError,
  title = '上传商品图',
  noun = '商品图片',
}: ProductImageFieldProps) {
  return (
    <>
      <ToolImageDropzone
        title={title}
        images={images}
        max={max}
        uploading={uploading}
        fileInputRef={fileInputRef}
        onFiles={onFiles}
        onRemove={onRemove}
        onOpenLibrary={onOpenLibrary}
        onOpenMobile={onOpenMobile}
        noun={noun}
      />
      {limitError && (
        <p className="pk-image-limit-error u-font-12" role="alert">
          {limitError}
        </p>
      )}
    </>
  );
}

export interface ProductFormSectionProps extends ProductImageFieldProps {
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
  maxLength: number;
  /** 描述文本域行数；商品主图与商品详情高度不同 */
  descriptionRows?: number;
  /** 配置卡内追加的板块（如自定义配置 / 包含模块） */
  extra?: ReactNode;
}

/**
 * 商品信息配置卡：商品图 + 基础字段 + 商品描述。
 *
 * 商品主图与商品详情共用；差异只剩上传上限来源、文本域高度与追加板块。
 */
export function ProductFormSection({
  images,
  max,
  uploading,
  fileInputRef,
  onFiles,
  onRemove,
  onOpenLibrary,
  onOpenMobile,
  limitError,
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
  maxLength,
  descriptionRows,
  extra,
}: ProductFormSectionProps) {
  return (
    <section className="pk-config-card">
      <ProductImageField
        images={images}
        max={max}
        uploading={uploading}
        fileInputRef={fileInputRef}
        onFiles={onFiles}
        onRemove={onRemove}
        onOpenLibrary={onOpenLibrary}
        onOpenMobile={onOpenMobile}
        limitError={limitError}
      />
      <ProductFieldsGrid
        productName={productName}
        onProductNameChange={onProductNameChange}
        brand={brand}
        onBrandChange={onBrandChange}
        platform={platform}
        onPlatformChange={onPlatformChange}
        language={language}
        onLanguageChange={onLanguageChange}
      />
      <ProductDescriptionField
        value={description}
        onChange={onDescriptionChange}
        analyzing={analyzing}
        onAnalyze={onAnalyze}
        onExpand={onExpandDescription}
        maxLength={maxLength}
        rows={descriptionRows}
      />
      {extra}
    </section>
  );
}

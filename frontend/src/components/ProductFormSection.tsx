import type { ReactNode } from 'react';
import { Maximize2, Sparkles } from 'lucide-react';

import { ToolImageDropzone } from './ToolImageDropzone';
import { MAX_PRODUCT_NAME_LEN } from '../lib/constants';
import { languageOptions, platformOptions } from '../lib/optionSets';
import type { UploadedImage } from '../hooks/useImageUpload';
import { Input, SectionCard, Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem, Textarea } from '../ui';

/** 必填星号；商品名称与标题共用同一枚，字重与色值只在 `.pk-required-mark` 定义 */
const REQUIRED_MARK = <i className="pk-required-mark u-font-14">*</i>;

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
  const mark = required ? REQUIRED_MARK : null;
  const grid = (
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
      {/* Select 不用 <label> 包裹: label 会把点击转发给内部 input, 导致下拉打开即关闭 */}
      <Select value={platform} onValueChange={(next) => onPlatformChange(String(next))}>
        <SelectTrigger aria-label="平台" className="w-full">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {platformOptions().map((option) => (
              <SelectItem key={String(option.value)} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select value={language} onValueChange={(next) => onLanguageChange(String(next))}>
        <SelectTrigger aria-label="语言" className="w-full">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {languageOptions().map((option) => (
              <SelectItem key={String(option.value)} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );

  // 独立成卡时标题由外层 `SectionCard` 承担，这里不再重复渲染分组标题
  if (!showTitle) return grid;

  return (
    <div className="grid gap-4">
      <strong className="text-sm leading-[22px] font-bold text-foreground">{mark}生成设置</strong>
      {grid}
    </div>
  );
}

export interface ProductDescriptionFieldProps {
  value: string;
  onChange: (value: string) => void;
  onExpand: () => void;
  maxLength: number;
  rows?: number;
}

/** 商品描述编辑器：文本域 + 放大编辑入口；标题行与 AI 分析按钮由外层卡片承担 */
export function ProductDescriptionField({
  value,
  onChange,
  onExpand,
  maxLength,
  rows = 3,
}: ProductDescriptionFieldProps) {
  return (
    <div className={`pk-desc-editor${rows >= 5 ? ' pk-desc-editor-tall' : ''}`}>
      <Textarea
        className="field-sizing-fixed"
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
  );
}

export interface ProductImageFieldProps {
  images: UploadedImage[];
  /** 当前模型能力合同允许的图片数（已与页面上限取较小值） */
  max: number;
  uploading: boolean;
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
  /** 追加在表单卡组之后的板块（如自定义配置 / 包含模块） */
  extra?: ReactNode;
}

/**
 * 商品信息卡组：商品图 / 生成设置 / 商品描述三张独立卡片。
 *
 * 商品主图与商品详情共用；差异只剩上传上限来源、文本域高度与追加板块。
 * 上传卡不传标题（`ImageUploadHeader` 自带），另两张卡片的标题与右侧动作
 * 由 `SectionCard` 的标题行承担，组内组件只渲染内容。
 */
export function ProductFormSection({
  images,
  max,
  uploading,
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
    <>
      <SectionCard>
        <ProductImageField
          images={images}
          max={max}
          uploading={uploading}
          onFiles={onFiles}
          onRemove={onRemove}
          onOpenLibrary={onOpenLibrary}
          onOpenMobile={onOpenMobile}
          limitError={limitError}
        />
      </SectionCard>

      <SectionCard
        title={
          <>
            {REQUIRED_MARK}生成设置
          </>
        }
      >
        <ProductFieldsGrid
          productName={productName}
          onProductNameChange={onProductNameChange}
          brand={brand}
          onBrandChange={onBrandChange}
          platform={platform}
          onPlatformChange={onPlatformChange}
          language={language}
          onLanguageChange={onLanguageChange}
          showTitle={false}
        />
      </SectionCard>

      <SectionCard
        title={
          <>
            {REQUIRED_MARK}商品描述
          </>
        }
        extra={
          <button
            type="button"
            className="pk-ai-btn u-font-12 u-py-4 u-px-10"
            disabled={analyzing}
            onClick={onAnalyze}
          >
            <Sparkles size={12} />
            <span>{analyzing ? '分析中…' : 'AI分析'}</span>
          </button>
        }
      >
        <ProductDescriptionField
          value={description}
          onChange={onDescriptionChange}
          onExpand={onExpandDescription}
          maxLength={maxLength}
          rows={descriptionRows}
        />
      </SectionCard>

      {extra}
    </>
  );
}

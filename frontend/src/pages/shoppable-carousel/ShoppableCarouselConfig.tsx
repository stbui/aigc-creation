import type { RefObject } from 'react';
import { Sparkles } from 'lucide-react';

import {
  LANGUAGE_OPTIONS,
  MARKET_OPTIONS,
  MAX_IMAGE_MB,
  MAX_IMAGES,
  MAX_SELLING_POINTS_LEN,
  PLATFORM_OPTIONS,
  RATIO_OPTIONS,
  SELLING_POINTS_PLACEHOLDER,
} from './constants';
import { ToolImageDropzone } from './components';
import type { UploadedImage } from './hooks';
import type { ShoppableCarouselTemplate } from './api';
import { templateBeatsText } from './utils';
import { Input, Select, Switch } from '../../ui';

/**
 * 左栏配置区。
 *
 * 五个区块的顺序与文案严格对齐参考站实拍（`docs/shoppable-carousel-design.md` §3）：
 *   上传图片 → 生成设置 → 商品卖点&生成要求 → 生成模式 → 附加功能。
 *
 * 控件类型按本站体系落地：参考站用 antd 的 Select/Switch，本站用 `ui` 层的
 * 同名件；视觉令牌走 `--brand` 一族，不沿用参考站品牌蓝。
 */

export interface ShoppableCarouselConfigProps {
  images: UploadedImage[];
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;

  platform: string;
  onPlatformChange: (value: string) => void;
  market: string;
  onMarketChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  ratio: string;
  onRatioChange: (value: string) => void;

  sellingPoints: string;
  onSellingPointsChange: (value: string) => void;
  analyzing: boolean;
  onAnalyze: () => void;

  mode: 'ai' | 'template';
  onModeChange: (value: 'ai' | 'template') => void;
  /** 已选模板（模板生成模式下左栏要回显，参考站实拍有「暂未选择模板 / 换一个」两态） */
  selectedTemplate: ShoppableCarouselTemplate | null;
  /** 「换一个」：随机换一个模板并同步右侧选中态 */
  onShuffleTemplate: () => void;

  noText: boolean;
  onNoTextChange: (value: boolean) => void;
  socialCaption: boolean;
  onSocialCaptionChange: (value: boolean) => void;
}

export function ShoppableCarouselConfig({
  images,
  uploading,
  fileInputRef,
  onFiles,
  onRemove,
  onOpenLibrary,
  onOpenMobile,
  platform,
  onPlatformChange,
  market,
  onMarketChange,
  language,
  onLanguageChange,
  ratio,
  onRatioChange,
  sellingPoints,
  onSellingPointsChange,
  analyzing,
  onAnalyze,
  mode,
  onModeChange,
  selectedTemplate,
  onShuffleTemplate,
  noText,
  onNoTextChange,
  socialCaption,
  onSocialCaptionChange,
}: ShoppableCarouselConfigProps) {
  return (
    <>
      {/*
        左栏是**一整块白底 + 区块间距**（参考站实测 social-media-sidebarScroll
        的 5 个 section 直接排在白底上, 彼此无卡片边框）, 不是「每区块一张白卡」。
        本站在同一块白底上排 5 个区块, 区块间距 24px（参考站实测值）。
      */}
      <div className="sc-sections">
        <ToolImageDropzone
          title="上传图片"
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
          emptyHint="同一产品，最多 5 张。"
        />

        {/* ── 2. 生成设置（2×2 四组下拉 + 不加文字开关） ── */}
        <div className="pk-section">
          <strong className="pk-section-title">生成设置</strong>
          <div className="pk-form-grid">
            {/* Select 不用 <label> 包裹: label 会把点击转发给内部 input,
                已知会让下拉「打开即关闭」; 无障碍名走 aria-label */}
            <div className="pk-field">
              <span className="pk-field-label">投放平台</span>
              <Select
                value={platform}
                onChange={onPlatformChange}
                options={PLATFORM_OPTIONS}
                aria-label="投放平台"
              />
            </div>
            <div className="pk-field">
              <span className="pk-field-label">目标市场</span>
              <Select
                value={market}
                onChange={onMarketChange}
                options={MARKET_OPTIONS}
                aria-label="目标市场"
              />
            </div>
            <div className="pk-field">
              <span className="pk-field-label">输出语言</span>
              <Select
                value={language}
                onChange={onLanguageChange}
                options={LANGUAGE_OPTIONS}
                aria-label="输出语言"
              />
            </div>
            <div className="pk-field">
              <span className="pk-field-label">画面比例</span>
              <Select
                value={ratio}
                onChange={onRatioChange}
                options={RATIO_OPTIONS}
                aria-label="画面比例"
              />
            </div>
          </div>

          {/* 「图片不加文字」开关 (参考站第五块, 默认关) */}
          <div className="sc-toggle-row">
            <div className="sc-toggle-copy">
              <strong>图片不加文字</strong>
              <small>图片突出产品使用场景，不添加文字。</small>
            </div>
            <Switch checked={noText} onChange={onNoTextChange} aria-label="图片不加文字" />
          </div>
        </div>

      {/* ── 3. 商品卖点 & 生成要求 ── */}
        <div className="pk-section">
        <div className="pk-field-label-row">
          <span className="pk-section-title">商品卖点&生成要求</span>
          <div className="pk-desc-actions">
            <button
              type="button"
              className="pk-ai-btn"
              disabled={analyzing}
              onClick={onAnalyze}
            >
              <Sparkles size={12} />
              <span>{analyzing ? '生成中…' : 'AI 帮写'}</span>
            </button>
          </div>
        </div>
        <div className="pk-desc-editor sc-copy-editor">
          <textarea
            rows={5}
            maxLength={MAX_SELLING_POINTS_LEN}
            value={sellingPoints}
            placeholder={SELLING_POINTS_PLACEHOLDER}
            onChange={(e) => onSellingPointsChange(e.target.value)}
          />
        </div>
        </div>

        {/* ── 4. 生成模式（两选一卡片） ── */}
        <div className="pk-section">
          <strong className="pk-section-title">生成模式</strong>
          <div className="sc-mode-grid">
            <button
              type="button"
              aria-pressed={mode === 'ai'}
              className={`sc-mode-option${mode === 'ai' ? ' is-active' : ''}`}
              onClick={() => onModeChange('ai')}
            >
              <strong>AI 智能生成</strong>
              <small>根据商品特点和卖点，自动设计图文内容和排版。</small>
            </button>
            <button
              type="button"
              aria-pressed={mode === 'template'}
              className={`sc-mode-option${mode === 'template' ? ' is-active' : ''}`}
              onClick={() => onModeChange('template')}
            >
              <strong>模板生成</strong>
              <small>参考模板生成，从右侧选择一个模板。</small>
            </button>
          </div>

          {/*
            已选模板回显（参考站实拍）。
            切到「模板生成」后，左栏在模式卡下方出现一块灰底回显:
              · 未选: 「暂未选择模板」+「请从右侧选择合适的模板」
              · 已选: 缩略图 + 模板名 + 三拍文案 + 「换一个」
            缺了这块，用户切到模板模式后看不到自己选了什么，
            也不知道该去哪里选 —— 参考站正是用它在左栏闭环。
          */}
          {mode === 'template' && (
            <div className="sc-template-echo">
              {selectedTemplate ? (
                <>
                  <span className="sc-echo-thumb">
                    <img src={selectedTemplate.thumbFile} alt={selectedTemplate.name} loading="lazy" />
                  </span>
                  <div className="sc-echo-details" aria-live="polite">
                    <strong className="sc-echo-title" title={selectedTemplate.name}>
                      {selectedTemplate.name}
                    </strong>
                    <small className="sc-echo-desc" title={templateBeatsText(selectedTemplate)}>
                      {templateBeatsText(selectedTemplate)}
                    </small>
                  </div>
                  <button type="button" className="sc-echo-change" onClick={onShuffleTemplate}>
                    换一个
                  </button>
                </>
              ) : (
                <div className="sc-echo-details" aria-live="polite">
                  <strong className="sc-echo-title">暂未选择模板</strong>
                  <small className="sc-echo-desc">请从右侧选择合适的模板</small>
                </div>
              )}
            </div>
          )}
        </div>

      {/* ── 5. 附加功能 ── */}
        <div className="pk-section">
          <strong className="pk-section-title">附加功能</strong>
          {/* 参考站「附加功能」是**普通行**（无灰底块），只有「图片不加文字」带灰底 */}
          <div className="sc-toggle-row sc-toggle-row-plain">
            <span className="sc-toggle-label">社媒帖子发布文案</span>
            <Switch checked={socialCaption} onChange={onSocialCaptionChange} aria-label="社媒帖子发布文案" />
          </div>
        </div>
      </div>
    </>
  );
}

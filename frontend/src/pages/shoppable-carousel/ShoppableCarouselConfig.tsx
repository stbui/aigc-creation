import { Sparkles } from 'lucide-react';

import {
  LANGUAGE_OPTIONS,
  MARKET_OPTIONS,
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
import { Input, Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem, Switch } from '../../ui';

/**
 * 左栏配置区。
 *
 * 五个区块的顺序与文案严格对齐参考站实拍（`docs/shoppable-carousel-design.md` §3）：
 *   上传图片 → 生成设置 → 商品卖点&生成要求 → 生成模式 → 附加功能。
 *
 * 控件类型按本站体系落地：参考站用旧的 Select/Switch，本站用 `ui` 层的
 * 同名件；视觉令牌走 `--brand` 一族，不沿用参考站品牌蓝。
 */

/** 参考站上传框 364×104、2px 虚线、圆角 12；提示收成 14px 并去掉空态最小高。 */
const UPLOAD_ZONE = [
  'min-h-[104px]! border-2 border-dashed border-[var(--border-2)]! rounded-lg! bg-card! p-2!',
  '[&>[data-slot=image-upload-prompt]]:min-h-0! [&>[data-slot=image-upload-prompt]]:gap-1.5!',
  '[&>[data-slot=image-upload-prompt]>span:last-child]:text-sm!',
].join(' ');

export interface ShoppableCarouselConfigProps {
  images: UploadedImage[];
  uploading: boolean;
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
          uploading={uploading}
          onFiles={onFiles}
          onRemove={onRemove}
          onOpenLibrary={onOpenLibrary}
          onOpenMobile={onOpenMobile}
          noun="商品图片"
          dropzoneClassName={UPLOAD_ZONE}
        />

        {/* ── 2. 生成设置（2×2 四组下拉 + 不加文字开关） ── */}
        <div className="pk-section">
          <strong className="pk-section-title u-font-14">生成设置</strong>
          <div className="pk-form-grid">
            {/* Select 不用 <label> 包裹: label 会把点击转发给内部 input,
                已知会让下拉「打开即关闭」; 无障碍名走 aria-label */}
            <div className="pk-field">
              <Select value={platform} onValueChange={onPlatformChange}>
                <SelectTrigger aria-label="投放平台" className="w-full">
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PLATFORM_OPTIONS.map((option) => (
                      <SelectItem key={String(option.value)} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="pk-field">
              <Select value={market} onValueChange={onMarketChange}>
                <SelectTrigger aria-label="目标市场" className="w-full">
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {MARKET_OPTIONS.map((option) => (
                      <SelectItem key={String(option.value)} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="pk-field">
              <Select value={language} onValueChange={onLanguageChange}>
                <SelectTrigger aria-label="输出语言" className="w-full">
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {LANGUAGE_OPTIONS.map((option) => (
                      <SelectItem key={String(option.value)} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="pk-field">
              <Select value={ratio} onValueChange={onRatioChange}>
                <SelectTrigger aria-label="画面比例" className="w-full">
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {RATIO_OPTIONS.map((option) => (
                      <SelectItem key={String(option.value)} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 「图片不加文字」开关 (参考站第五块, 默认关) */}
          <div className="sc-toggle-row">
            <div className="sc-toggle-copy">
              <strong>图片不加文字</strong>
              <small>图片突出产品使用场景，不添加文字。</small>
            </div>
            <Switch checked={noText} onCheckedChange={onNoTextChange} aria-label="图片不加文字" />
          </div>
        </div>

      {/* ── 3. 商品卖点 & 生成要求 ── */}
        <div className="pk-section">
        <div className="pk-field-label-row">
          <span className="pk-section-title u-font-14">商品卖点&生成要求</span>
          <div className="pk-desc-actions">
            <button
              type="button"
              className="pk-ai-btn u-font-12 u-py-4 u-px-10"
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
          <strong className="pk-section-title u-font-14">生成模式</strong>
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
          <strong className="pk-section-title u-font-14">附加功能</strong>
          {/* 参考站「附加功能」是**普通行**（无灰底块），只有「图片不加文字」带灰底 */}
          <div className="sc-toggle-row sc-toggle-row-plain">
            <span className="sc-toggle-label">社媒帖子发布文案</span>
            <Switch checked={socialCaption} onCheckedChange={onSocialCaptionChange} aria-label="社媒帖子发布文案" />
          </div>
        </div>
      </div>
    </>
  );
}

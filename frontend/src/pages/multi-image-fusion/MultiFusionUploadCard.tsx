import { ImagePlus } from 'lucide-react';

import {
  MAX_ACCENTS,
  MAX_TOTAL,
  type MultiFusionSlot,
} from './constants';
import {
  Badge,
  Button,
  Field,
  FieldTitle,
  ImageDropzone,
  ImageUploadArea,
  SectionCard,
  type ImageUploadControls,
  type ToolAsset,
} from './components';
import { useUploadLimits } from '../../context/UploadLimitsContext';
import { MultiFusionImageThumb } from './MultiFusionImageThumb';
import { MultiFusionSlotActions } from './MultiFusionSlotActions';

/**
 * 上传卡 —— 主体图（1 张）+ 搭配图（1-5 张）两个图位。
 *
 * 2026-11-21 由 1902 行页面 CSS 的 `multi-image-fusion-*` 自绘结构改为 C 端组件层：
 * 卡片壳 `SectionCard`、计数器 `Badge`、图位标签 `Field` / `FieldLabel`、
 * 上传空态 `ImageDropzone`（只负责空态外观）、已上传图 `MultiFusionImageThumb`
 * （内部为 `Attachment`）。搭配图网格只保留列宽，拖拽命中由外层上传区接管。
 *
 * 两个图位各有两个补图入口：素材库导入与手机上传；拖拽与粘贴也落到对应图位。
 * 隐藏 input、拖拽命中、loading 与缩略图/补位的转交统一由共享
 * `ImageUploadArea` 承担，页面只关心「拿到文件」。
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
  const { accept, allowedLabel, maxMb } = useUploadLimits();
  const subjectHint = `支持 ${allowedLabel}，单张不超过 ${maxMb}MB，可直接粘贴`;

  /**
   * 参考站搭配图只有一个添加入口，槽内文案明确剩余额度。
   * 已满 5 张时不再渲染添加入口。
   */
  const renderAccentGrid = (items: ToolAsset[], controls: ImageUploadControls) => {
    const room = Math.max(0, MAX_ACCENTS - items.length);
    return (
      <div className="grid grid-cols-3 gap-2">
        {items.map((accent) => (
          <MultiFusionImageThumb
            key={accent.id}
            asset={accent}
            uploading={uploading}
            removeLabel={`移除 ${accent.name}`}
            className="h-[108px] w-full [&_[data-slot=attachment-media]]:h-full"
            onRemove={() => controls.remove(accent.id)}
          />
        ))}
        {room > 0 && (
          <ImageDropzone
            size="compact"
            title="添加搭配图"
            hint={`还可添加 ${room} 张`}
            icon={<ImagePlus aria-hidden />}
            className="h-[108px]"
            onClick={controls.open}
          />
        )}
      </div>
    );
  };

  return (
    <SectionCard
      title="上传图片"
      extra={
        <Badge variant="secondary" className="min-w-9 shrink-0 text-xs font-normal">
          {totalCount} / {MAX_TOTAL}
        </Badge>
      }
      contentClassName="flex flex-col gap-4.5"
    >
      {/* 主体图: 必传 1 张 */}
      <Field className="gap-2">
        <div className="flex min-h-5.5 w-full items-center gap-2">
          <FieldTitle className="text-xs font-bold text-foreground">主体图</FieldTitle>
          <span className="text-xs font-normal text-muted-foreground">必传 · 1 张</span>
          <MultiFusionSlotActions
            target="subject"
            onOpenLibrary={onOpenLibrary}
            onOpenMobile={onOpenMobile}
          />
        </div>

        <ImageUploadArea
          images={subject ? [subject] : []}
          max={1}
          single
          variant="plain"
          uploading={uploading}
          accept={accept}
          ariaLabel="上传主体图"
          replaceOnClick={Boolean(subject)}
          emptyContent={(controls) => (
            <ImageDropzone
              title="上传主体图"
              hint={subjectHint}
              icon={<ImagePlus aria-hidden />}
              onClick={controls.open}
            />
          )}
          renderPreview={(items, controls) => {
            const image = items[0];
            if (!image) return null;
            return (
              <div className="relative h-[138px] w-full">
                <MultiFusionImageThumb
                  asset={image}
                  uploading={uploading}
                  removeLabel="移除主体图"
                  className="h-full w-full [&_[data-slot=attachment-media]]:h-full"
                  onRemove={() => controls.remove(image.id)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="absolute inset-x-1.5 bottom-1.5 h-auto min-h-7 border border-white/40 bg-foreground/70 px-2 text-xs font-normal text-primary-foreground hover:bg-foreground/85 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    controls.open();
                  }}
                >
                  替换主体图
                </Button>
              </div>
            );
          }}
          onFiles={(files) => onUploadFiles('subject', files)}
          onRemove={onRemoveSubject}
        />
      </Field>

      {/* 搭配图: 必传 1-5 张, 参考站是网格小槽 (S-8) */}
      <Field className="gap-2">
        <div className="flex min-h-5.5 w-full items-center gap-2">
          <FieldTitle className="text-xs font-bold text-foreground">搭配图</FieldTitle>
          <span className="text-xs font-normal text-muted-foreground">必传 · 1-5 张</span>
          <MultiFusionSlotActions
            target="accent"
            onOpenLibrary={onOpenLibrary}
            onOpenMobile={onOpenMobile}
          />
        </div>

        <ImageUploadArea
          images={accents}
          max={MAX_ACCENTS}
          variant="plain"
          uploading={uploading}
          accept={accept}
          ariaLabel="上传搭配图"
          emptyContent={(controls) => renderAccentGrid([], controls)}
          renderPreview={renderAccentGrid}
          onFiles={(files) => onUploadFiles('accent', files)}
          onRemove={onRemoveAccent}
        />
      </Field>
    </SectionCard>
  );
}

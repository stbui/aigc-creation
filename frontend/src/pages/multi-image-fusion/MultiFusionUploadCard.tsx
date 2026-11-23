import { ImagePlus } from 'lucide-react';

import {
  MAX_ACCENTS,
  MAX_TOTAL,
  SUPPORTED_IMAGE_ACCEPT,
  UPLOAD_SUBJECT_HINT,
  type MultiFusionSlot,
} from './constants';
import {
  Badge,
  Field,
  FieldTitle,
  ImageDropzone,
  ImageUploadArea,
  Surface,
  SurfaceContent,
  SurfaceHeader,
  SurfaceTitle,
  type ImageUploadControls,
  type ToolAsset,
} from './components';
import { MultiFusionImageThumb } from './MultiFusionImageThumb';
import { MultiFusionSlotActions } from './MultiFusionSlotActions';

/**
 * 上传卡 —— 主体图（1 张）+ 搭配图（1-5 张）两个图位。
 *
 * 2026-11-21 由 1902 行页面 CSS 的 `multi-image-fusion-*` 自绘结构改为 shadcn：
 * 卡片壳 `Surface`、计数器 `Badge`、图位标签 `Field` / `FieldLabel`、
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
    <Surface className="gap-4.5 rounded-xl border-border/70 bg-card p-4.5 shadow-card">
      <SurfaceHeader className="mb-3 flex items-start gap-3 px-0">
        <SurfaceTitle className="text-sm leading-5.5 font-bold text-foreground">
          上传图片
        </SurfaceTitle>
        <Badge variant="secondary" className="ml-auto min-w-9 shrink-0 text-xs font-normal">
          {totalCount} / {MAX_TOTAL}
        </Badge>
      </SurfaceHeader>

      <SurfaceContent className="flex flex-col gap-4.5 px-0">
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
            accept={SUPPORTED_IMAGE_ACCEPT}
            ariaLabel="上传主体图"
            emptyContent={(controls) => (
              <ImageDropzone
                title="上传主体图"
                hint={UPLOAD_SUBJECT_HINT}
                icon={<ImagePlus aria-hidden />}
                onClick={controls.open}
              />
            )}
            renderPreview={(items, controls) => {
              const image = items[0];
              if (!image) return null;
              return (
                <MultiFusionImageThumb
                  asset={image}
                  uploading={uploading}
                  removeLabel="移除主体图"
                  className="h-[138px] w-full [&_[data-slot=attachment-media]]:h-full"
                  onRemove={() => controls.remove(image.id)}
                />
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
            accept={SUPPORTED_IMAGE_ACCEPT}
            ariaLabel="上传搭配图"
            emptyContent={(controls) => renderAccentGrid([], controls)}
            renderPreview={renderAccentGrid}
            onFiles={(files) => onUploadFiles('accent', files)}
            onRemove={onRemoveAccent}
          />
        </Field>
      </SurfaceContent>
    </Surface>
  );
}

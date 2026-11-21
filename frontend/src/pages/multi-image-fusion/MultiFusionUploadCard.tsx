import { useRef } from 'react';
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
  Surface,
  SurfaceContent,
  SurfaceHeader,
  SurfaceTitle,
  type ToolAsset,
} from './components';
import { MultiFusionImageThumb } from './MultiFusionImageThumb';
import { MultiFusionSlotActions } from './MultiFusionSlotActions';

/**
 * 上传卡 —— 主体图（1 张）+ 搭配图（1-5 张）两个图位。
 *
 * 2026-11-21 由 1902 行页面 CSS 的 `multi-image-fusion-*` 自绘结构改为 shadcn：
 * 卡片壳 `Surface`、计数器 `Badge`、图位标签 `Field` / `FieldLabel`、
 * 上传空态 `ImageDropzone`（已封装拖拽命中区）、已上传图 `MultiFusionImageThumb`
 * （内部为 `Attachment`）。搭配图网格只保留列宽，拖拽命中交给各槽位自身。
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
  /**
   * 参考站搭配图空态只有一个添加入口，槽内文案明确剩余额度。
   * 已满 5 张时不再渲染添加入口。
   */
  const accentRoom = Math.max(0, MAX_ACCENTS - accents.length);
  const pickSubject = () => subjectInputRef.current?.click();
  const pickAccent = () => accentInputRef.current?.click();

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

          {subject ? (
            <MultiFusionImageThumb
              asset={subject}
              uploading={uploading}
              removeLabel="移除主体图"
              className="h-[138px] w-full [&_[data-slot=attachment-media]]:h-full"
              onRemove={onRemoveSubject}
            />
          ) : (
            <ImageDropzone
              title="上传主体图"
              hint={UPLOAD_SUBJECT_HINT}
              icon={<ImagePlus aria-hidden />}
              onClick={pickSubject}
              onFiles={(files) => onUploadFiles('subject', files)}
            />
          )}
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

          <div className="grid grid-cols-3 gap-2">
            {accents.map((accent) => (
              <MultiFusionImageThumb
                key={accent.id}
                asset={accent}
                uploading={uploading}
                removeLabel={`移除 ${accent.name}`}
                className="h-[108px] w-full [&_[data-slot=attachment-media]]:h-full"
                onRemove={() => onRemoveAccent(accent.id)}
              />
            ))}
            {/* 参考站空态只有一个添加入口，并在槽内写明剩余额度 */}
            {accentRoom > 0 && (
              <ImageDropzone
                size="compact"
                title="添加搭配图"
                hint={`还可添加 ${accentRoom} 张`}
                icon={<ImagePlus aria-hidden />}
                className="h-[108px]"
                onClick={pickAccent}
                onFiles={(files) => onUploadFiles('accent', files)}
              />
            )}
          </div>
        </Field>
      </SurfaceContent>

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
    </Surface>
  );
}

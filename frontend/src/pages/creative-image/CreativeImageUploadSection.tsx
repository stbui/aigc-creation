import { Plus } from 'lucide-react';

import { useUploadLimits } from '../../context/UploadLimitsContext';
import {
  ImageUploadArea,
  ImageUploadHeader,
  type ImageUploadControls,
  type ToolAsset,
} from './components';
import { CreativeImageReferenceThumb } from './CreativeImageReferenceThumb';

interface CreativeImageUploadSectionProps {
  images: ToolAsset[];
  /** 参考图位数上限（本页固定 4，由页面下发） */
  maxImages: number;
  uploading: boolean;
  /** 拿到文件后由页面统一做格式 / 体积 / 额度校验与上传 */
  onUploadFiles: (files: FileList | File[]) => void | Promise<void>;
  onRemoveImage: (id: string) => void;
  onMoveImage: (index: number, direction: -1 | 1) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
}

/**
 * 参考图上传区：标题行、空态占位、拖拽 / 点击 / 粘贴入口、缩略图网格与排序。
 *
 * 标题行与「从素材库导入 / 手机上传」入口由共享 `ImageUploadHeader` 承担
 * （2026-11-23 收敛时漏接，2026-11-25 补回）；隐藏 input、拖拽命中与 loading
 * 由 `ImageUploadArea` 承担；本组件只提供参考图空态、带排序箭头的缩略图网格
 * 与「添加」补位，页面只关心「拿到文件」。
 */
export function CreativeImageUploadSection({
  images,
  maxImages,
  uploading,
  onUploadFiles,
  onRemoveImage,
  onMoveImage,
  onOpenLibrary,
  onOpenMobile,
}: CreativeImageUploadSectionProps) {
  const { accept, maxMb } = useUploadLimits();

  const renderGrid = (items: ToolAsset[], controls: ImageUploadControls) => {
    const hasRoom = items.length < maxImages;
    return (
      <>
        <div className="grid w-full grid-cols-[repeat(auto-fill,80px)] content-start items-start justify-start gap-2.5">
          {items.map((image, index) => (
            <CreativeImageReferenceThumb
              key={image.id}
              image={image}
              index={index}
              total={items.length}
              onMove={onMoveImage}
              onRemove={onRemoveImage}
            />
          ))}
          {hasRoom && (
            <button
              type="button"
              className="flex size-20 cursor-pointer flex-col items-center justify-center gap-2.5 rounded-md border border-muted bg-muted p-0 text-[color:var(--text-body)] hover:border-[var(--border-hover)]"
              onClick={(event) => {
                event.stopPropagation();
                controls.open();
              }}
            >
              <Plus size={18} />
              <span className="text-xs leading-[22px] text-[color:var(--text-body)]">添加</span>
            </button>
          )}
        </div>
        <p className="mx-0 mt-2 mb-0 text-xs leading-[18px] text-[color:var(--text-desc)]">
          使用箭头调整参考图顺序，顺序会影响生成构图
        </p>
      </>
    );
  };

  return (
    <>
      <ImageUploadHeader
        title="上传参考图"
        count={`${images.length}/${maxImages}`}
        onOpenLibrary={onOpenLibrary}
        onOpenMobile={onOpenMobile}
        mobileHint="扫码在手机上选择图片，接收后自动进入参考图位"
      />
      <ImageUploadArea
        images={images}
        max={maxImages}
        uploading={uploading}
        accept={accept}
        className={
          images.length > 0
            ? 'min-h-0! cursor-default border-0! bg-transparent! p-0! block! hover:border-0! hover:bg-transparent! hover:ring-0!'
            : undefined
        }
        ariaLabel="上传参考图"
        emptyTitle="点击、拖拽或粘贴参考图片到此处上传"
        emptyHint={`最多可上传 ${maxImages} 张参考图片，单张不超过 ${maxMb}MB`}
        emptyClassName="max-w-none! rounded-md p-2 text-xs! leading-5!"
        emptyIconClassName="mb-5"
        renderPreview={renderGrid}
        onFiles={(files) => void onUploadFiles(files)}
        onRemove={onRemoveImage}
      />
    </>
  );
}

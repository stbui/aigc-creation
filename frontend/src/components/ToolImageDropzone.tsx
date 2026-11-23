import { useUploadLimits } from '../context/UploadLimitsContext';
import { assetThumbUrl } from '../lib/api';
import { Button, ImageUploadArea, ImageUploadHeader, ImageUploadThumb } from '../ui';

/**
 * 工具页图片上传区 —— 2026-10-19 从 4 个大页面抽出。
 *
 * 抽出前的事实（difflib 归一化比对，见 docs/refactor-dedup.md §1）：
 *   ProductKitPage:270-353 ⇄ ProductDetailPage:259-342 ⇄ ViralClonePage:274-357
 *   三处 **逐字节相同（diff 输出 0 行）**；FreeCreationPage:159-242 为同一结构变体
 *   （标题无必填星号、上限 4 张）。全项目共 4 份。
 *
 * 2026-11-23 起上传命中区、隐藏 input、拖拽高亮与缩略图网格下沉到
 * `ui/primitives/image-upload-area.tsx`，标题行与素材库 / 手机入口下沉到
 * `ui/primitives/image-upload-header.tsx`；本组件只负责把两段原子件拼成工具页
 * 上传区，文案与额度差异通过 props 下发。上传校验、上传调用、素材库回填仍归页面。
 */

export interface ToolUploadImage {
  id: string;
  url: string;
  name: string;
}

interface Props {
  /** 区块标题, 如「上传商品图」/「上传参考图」 */
  title: string;
  /** 标题前是否带红色必填星号（参考站「上传商品图」带、「上传参考图」不带） */
  required?: boolean;
  images: ToolUploadImage[];
  /** 数量上限 */
  max: number;
  uploading: boolean;
  onFiles: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  onOpenLibrary: () => void;
  /** 打开手机上传弹窗 (二维码方案; 弹窗由页面渲染) */
  onOpenMobile: () => void;
  /** 空态文案里的名词, 如「商品图片」/「参考图片」 */
  noun?: string;
  /** file input 的 accept, 缺省与参考站一致 */
  accept?: string;
  /* ── 以下为「爆款复刻 · 参考图」区与「自由创作 · 参考图」区的差异化开关 ── */
  /** 额外挂到 .pk-section 上的 class, 如 vc-reference-section */
  sectionClassName?: string;
  /** 额外挂到上传命中区上的 class，用于页面级 tw 覆盖（按 data-slot / data-* 选择） */
  dropzoneClassName?: string;
  /** 单图模式: 空态与缩略图按单列布局, file input 不带 multiple */
  single?: boolean;
  /** 标题行右侧是否显示「n/max」计数器（参考图区无计数器） */
  showCount?: boolean;
  /** 空态副文案；不传则用「最多可上传 n 张{noun}，单张不超过 xMB」 */
  emptyHint?: string;
}

export function ToolImageDropzone({
  title,
  required = true,
  images,
  max,
  uploading,
  onFiles,
  onRemove,
  onOpenLibrary,
  onOpenMobile,
  noun = '商品图片',
  accept,
  sectionClassName,
  dropzoneClassName,
  single = false,
  showCount = true,
  emptyHint,
}: Props) {
  const { accept: configuredAccept, maxMb } = useUploadLimits();
  const effectiveAccept = accept ?? configuredAccept;

  return (
    <div className={`pk-section${sectionClassName ? ` ${sectionClassName}` : ''}`}>
      <ImageUploadHeader
        title={title}
        required={required}
        count={showCount ? `${images.length}/${max}` : undefined}
        onOpenLibrary={onOpenLibrary}
        onOpenMobile={onOpenMobile}
        mobileHint="用手机扫码上传，图片回填到上方"
      />

      <ImageUploadArea
        images={images.map((image) => ({
          ...image,
          thumbUrl: assetThumbUrl(image.url, 320) ?? image.url,
        }))}
        max={max}
        uploading={uploading}
        accept={effectiveAccept}
        single={single}
        className={dropzoneClassName}
        ariaLabel={title}
        replaceOnClick={single && images.length > 0}
        renderThumb={
          single
            ? (image, _index, controls) => (
                <div className="relative w-full">
                  <ImageUploadThumb
                    item={image}
                    removeLabel={`移除 ${image.name}`}
                    className="w-full"
                    onRemove={onRemove}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`替换${noun}`}
                    className="absolute inset-x-1.5 bottom-1.5 h-auto min-h-7 border border-white/40 bg-foreground/70 px-2 text-xs font-normal text-primary-foreground hover:bg-foreground/85 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
                    onClick={(event) => {
                      event.stopPropagation();
                      controls.open();
                    }}
                  >
                    替换图片
                  </Button>
                </div>
              )
            : undefined
        }
        addLabel={`添加${noun}`}
        emptyTitle={`点击、拖拽或粘贴${noun}到此处上传`}
        emptyHint={emptyHint ?? `最多可上传 ${max} 张${noun}，单张不超过 ${maxMb}MB`}
        onFiles={onFiles}
        onRemove={onRemove}
      />
    </div>
  );
}

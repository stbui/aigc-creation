import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';

import { assetThumbUrl } from '../lib/api';
import { ImageUploadArea, ImageUploadHeader } from '../ui';
import type { ToolAsset, UploadPreviewControls, UploadSpec } from './toolShellTypes';

/**
 * 工具页左栏的「上传卡」。
 *
 * 2026-11-14 从 `ToolShell` 抽出：只负责把图片位渲染成可拖拽的 dropzone
 * （标题行 + 素材库/手机上传入口 + 缩略图网格或页面自定义预览），
 * 图片位的状态与写操作在 `useToolUploadSlots`，本组件只读不写业务规则。
 *
 * 2026-11-23 起隐藏 input、拖拽命中区、loading 与默认缩略图网格下沉到
 * `ui/primitives/image-upload-area.tsx`，标题行与素材库 / 手机入口下沉到
 * `ui/primitives/image-upload-header.tsx`；本组件保留页面自定义预览与上传卡壳。
 */
interface Props {
  upload: UploadSpec;
  images: ToolAsset[];
  uploading: boolean;
  allowedAccept: string;
  /** 自定义已上传图片位（局部重绘的预览 / 重新编辑 / 重新上传）。 */
  renderUploadPreview?: (images: ToolAsset[], controls: UploadPreviewControls) => ReactNode;
  onFiles: (files: FileList | File[]) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
  onRemove: (id: string) => void;
  onPreview: (image: ToolAsset) => void;
}

export function ToolUploadCard({
  upload,
  images,
  uploading,
  allowedAccept,
  renderUploadPreview,
  onFiles,
  onOpenLibrary,
  onOpenMobile,
  onRemove,
  onPreview,
}: Props) {
  return (
    <section className="pk-config-card">
      <div className="pk-section">
        <ImageUploadHeader
          title={upload.title}
          required={upload.required}
          count={upload.max > 1 ? `${images.length}/${upload.max}` : undefined}
          onOpenLibrary={onOpenLibrary}
          onOpenMobile={onOpenMobile}
          mobileHint="用手机扫码上传，图片回填到左侧"
        />

        <ImageUploadArea
          images={images.map((image) => ({
            ...image,
            thumbUrl: assetThumbUrl(image.url, 320) ?? image.url,
          }))}
          max={upload.max}
          uploading={uploading}
          accept={upload.accept ?? allowedAccept}
          single={upload.max === 1}
          className={upload.dropzoneClassName}
          ariaLabel={upload.title}
          emptyTitle={upload.prompt ?? '点击或拖拽图片到此处上传'}
          emptyHint={upload.hint}
          emptyIcon={upload.promptIcon ?? <Plus size={22} />}
          renderPreview={renderUploadPreview}
          onFiles={onFiles}
          onRemove={onRemove}
          onPreview={onPreview}
        />
      </div>
    </section>
  );
}

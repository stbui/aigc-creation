import type { RefObject } from 'react';

import { SUPPORTED_IMAGE_ACCEPT } from './constants';
import {
  Button,
  Spin,
  Surface,
  SurfaceAction,
  SurfaceContent,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
  type ToolAsset,
} from './components';
import { ProductSkuTemplateDropzone } from './ProductSkuTemplateDropzone';
import { ProductSkuTemplatePreview } from './ProductSkuTemplatePreview';

interface ProductSkuTemplateCardProps {
  template: ToolAsset | null;
  uploading: boolean;
  /** 隐藏文件选择框由卡片自持，页面只接收选中的文件 */
  templateInputRef: RefObject<HTMLInputElement | null>;
  onUpload: (files: FileList | File[]) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
  onEditRegions: () => void;
  onPreview: (url: string) => void;
}

/**
 * 模板图卡片：上传 / 拖拽 / 素材库 / 手机上传与重新框选。
 *
 * 上传、框选与预览动作由页面提供；这里只负责卡片编排与拖拽命中区，
 * 空态与已选态分别落在 `ProductSkuTemplateDropzone` / `ProductSkuTemplatePreview`。
 */
export function ProductSkuTemplateCard({
  template,
  uploading,
  templateInputRef,
  onUpload,
  onOpenLibrary,
  onOpenMobile,
  onEditRegions,
  onPreview,
}: ProductSkuTemplateCardProps) {
  const openFilePicker = () => templateInputRef.current?.click();

  return (
    <Surface className="product-sku-card product-sku-template-card border-0 shadow-none">
      <SurfaceHeader className="mb-3 gap-1 px-0">
        <SurfaceTitle className="text-sm leading-5 font-bold">SKU模板图</SurfaceTitle>
        <SurfaceAction className="product-sku-card-heading-actions">
          <Button
            htmlType="button"
            variant="ghost"
            className="workspace-material-library-trigger h-auto hover:bg-transparent"
            onClick={onOpenLibrary}
          >
            从素材库导入
          </Button>
          <Button
            htmlType="button"
            variant="ghost"
            className="mobile-upload-trigger mobile-upload-qr-trigger h-auto hover:bg-transparent"
            onClick={onOpenMobile}
          >
            手机上传
          </Button>
        </SurfaceAction>
        <SurfaceDescription className="product-sku-card-heading-copy">
          选一张结构最完整的成品图作为模板，框选要跟随SKU变动的区域，最多支持3个SKU变体区域
        </SurfaceDescription>
      </SurfaceHeader>

      <SurfaceContent className="px-0">
        <input
          ref={templateInputRef}
          type="file"
          accept={SUPPORTED_IMAGE_ACCEPT}
          hidden
          onChange={(event) => {
            if (event.target.files) onUpload(event.target.files);
            event.target.value = '';
          }}
        />

        <div
          className="relative grid gap-2"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onUpload(event.dataTransfer.files);
          }}
        >
          {uploading && (
            <span
              className="absolute inset-0 z-10 grid place-items-center rounded-md bg-background/70"
              aria-live="polite"
            >
              <Spin size="small" />
            </span>
          )}

          {template ? (
            <ProductSkuTemplatePreview
              template={template}
              onPreview={onPreview}
              onEditRegions={onEditRegions}
              onReupload={openFilePicker}
            />
          ) : (
            <ProductSkuTemplateDropzone onPick={openFilePicker} />
          )}
        </div>
      </SurfaceContent>
    </Surface>
  );
}

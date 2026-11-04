import type { RefObject } from 'react';
import { ImagePlus } from 'lucide-react';

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
import { assetThumbUrl } from './api';

/**
 * 模板图卡片：上传 / 拖拽 / 素材库 / 手机上传与重新框选。
 *
 * 上传、框选与清空动作由页面提供；这里只负责展示与事件转发。
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
}: {
  template: ToolAsset | null;
  uploading: boolean;
  templateInputRef: RefObject<HTMLInputElement | null>;
  onUpload: (files: FileList | File[]) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
  onEditRegions: () => void;
  onPreview: (url: string) => void;
}) {
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
            <div className="flex min-h-40 items-start gap-6 max-[900px]:gap-3.5 max-[560px]:min-h-0 max-[560px]:flex-col max-[560px]:gap-2.5">
              <Button
                htmlType="button"
                variant="ghost"
                aria-label="预览模板图"
                className="size-40 shrink-0 cursor-zoom-in overflow-hidden rounded-md border-0 p-0 hover:bg-transparent max-[900px]:size-33 max-[560px]:aspect-square max-[560px]:h-auto max-[560px]:w-full"
                onClick={() => onPreview(template.url)}
              >
                <img
                  className="size-full object-cover"
                  src={assetThumbUrl(template.url, 320) ?? template.url}
                  alt={template.name}
                />
              </Button>
              <div className="grid auto-rows-10 gap-2.5 max-[560px]:w-full max-[560px]:auto-rows-8.5 max-[560px]:gap-1.5">
                <Button htmlType="button" variant="outline" className="min-w-22" onClick={onEditRegions}>
                  重新编辑
                </Button>
                <Button
                  htmlType="button"
                  variant="secondary"
                  className="min-w-22"
                  onClick={() => templateInputRef.current?.click()}
                >
                  重新上传
                </Button>
              </div>
            </div>
          ) : (
            <Button
              htmlType="button"
              variant="outline"
              className="h-auto min-h-40 w-full flex-col gap-1.5 rounded-md border-dashed bg-muted px-4 py-4 whitespace-normal text-muted-foreground hover:border-brand max-[560px]:min-h-32.5"
              onClick={() => templateInputRef.current?.click()}
            >
              <ImagePlus className="size-5.5 text-brand" />
              <strong className="text-xs font-medium text-foreground">点击或拖拽图片到此处上传</strong>
              <span className="text-xs font-normal">点击、拖拽或粘贴图片上传，最多 1 张</span>
            </Button>
          )}
        </div>
      </SurfaceContent>
    </Surface>
  );
}

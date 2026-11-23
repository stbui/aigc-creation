import { ImagePlus } from 'lucide-react';

import { SUPPORTED_IMAGE_ACCEPT } from './constants';
import {
  ImageDropzone,
  ImageUploadArea,
  SectionCard,
  TextAction,
  type ToolAsset,
} from './components';
import { ProductSkuTemplatePreview } from './ProductSkuTemplatePreview';

interface ProductSkuTemplateCardProps {
  template: ToolAsset | null;
  uploading: boolean;
  onUpload: (files: FileList | File[]) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
  onEditRegions: () => void;
  onPreview: (url: string) => void;
}

/**
 * 模板图卡片：上传 / 拖拽 / 素材库 / 手机上传与重新框选。
 *
 * 上传、框选与预览动作由页面提供；隐藏 input、拖拽命中与 loading 由共享
 * `ImageUploadArea` 承担，空态与已选态分别落在 `ImageDropzone` /
 * `ProductSkuTemplatePreview`。
 */
export function ProductSkuTemplateCard({
  template,
  uploading,
  onUpload,
  onOpenLibrary,
  onOpenMobile,
  onEditRegions,
  onPreview,
}: ProductSkuTemplateCardProps) {
  return (
    <SectionCard
      title="SKU模板图"
      extra={
        <>
          <TextAction onClick={onOpenLibrary}>从素材库导入</TextAction>
          <TextAction onClick={onOpenMobile}>手机上传</TextAction>
        </>
      }
    >
      <p className="m-0 text-xs leading-5 font-normal text-muted-foreground">
        选一张结构最完整的成品图作为模板，框选要跟随SKU变动的区域，最多支持3个SKU变体区域
      </p>

      <ImageUploadArea
        variant="plain"
        images={template ? [template] : []}
        max={1}
        single
        uploading={uploading}
        accept={SUPPORTED_IMAGE_ACCEPT}
        ariaLabel="上传SKU模板图"
        emptyContent={(controls) => (
          <ImageDropzone
            title="点击或拖拽图片到此处上传"
            hint="点击、拖拽或粘贴图片上传，最多 1 张"
            icon={<ImagePlus aria-hidden />}
            onClick={controls.open}
          />
        )}
        renderPreview={(items, controls) => {
          const image = items[0];
          if (!image) return null;
          return (
            <ProductSkuTemplatePreview
              template={image}
              onPreview={onPreview}
              onEditRegions={onEditRegions}
              onReupload={controls.open}
            />
          );
        }}
        onFiles={onUpload}
      />
    </SectionCard>
  );
}

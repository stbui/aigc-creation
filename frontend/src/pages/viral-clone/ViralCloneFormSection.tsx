import type { AssetSlot } from './constants';
import { useUploadLimits } from '../../context/UploadLimitsContext';
import { ProductFieldsGrid, SectionCard, ToolImageDropzone } from './components';
import type { UploadedImage } from './hooks';

/**
 * 爆款复刻左栏表单区：上传商品图 / 上传参考图（爆款图）/ 生成设置。
 *
 * 与商品详情、商品主图的 `*FormSection` 同角色，同样按分组拆成独立
 * `SectionCard`（白底 + `--radius-panel` + 16px 内边距），三页左栏的卡片
 * 节奏一致。参考图是单张位，标题行不显示计数器；商品基础字段走共享
 * `ProductFieldsGrid`，名称 / 品牌在本页为选填，标题不带必填星号。
 */
export function ViralCloneFormSection({
  images,
  maxImages,
  reference,
  uploading,
  productName,
  brand,
  platform,
  language,
  onProductFiles,
  onReferenceFiles,
  onRemoveImage,
  onRemoveReference,
  onOpenLibrary,
  onOpenMobile,
  onProductNameChange,
  onBrandChange,
  onPlatformChange,
  onLanguageChange,
}: {
  images: UploadedImage[];
  /** 商品图位上限，已为参考图预留 1 个模型输入位 */
  maxImages: number;
  reference: UploadedImage | null;
  uploading: boolean;
  productName: string;
  brand: string;
  platform: string;
  language: string;
  onProductFiles: (files: FileList | File[]) => void;
  onReferenceFiles: (files: FileList | File[]) => void;
  onRemoveImage: (id: string) => void;
  onRemoveReference: () => void;
  onOpenLibrary: (target: AssetSlot) => void;
  onOpenMobile: (target: AssetSlot) => void;
  onProductNameChange: (value: string) => void;
  onBrandChange: (value: string) => void;
  onPlatformChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
}) {
  const { maxMb } = useUploadLimits();

  return (
    <>
      <SectionCard>
        <ToolImageDropzone
          title="上传商品图"
          images={images}
          max={maxImages}
          uploading={uploading}
          onFiles={onProductFiles}
          onRemove={onRemoveImage}
          onOpenLibrary={() => onOpenLibrary('product')}
          onOpenMobile={() => onOpenMobile('product')}
          noun="商品图片"
        />
      </SectionCard>

      <SectionCard>
        <ToolImageDropzone
          title="上传参考图（爆款图）"
          images={reference ? [reference] : []}
          max={1}
          uploading={uploading}
          onFiles={onReferenceFiles}
          onRemove={onRemoveReference}
          onOpenLibrary={() => onOpenLibrary('reference')}
          onOpenMobile={() => onOpenMobile('reference')}
          noun="参考图片"
          sectionClassName="vc-reference-section"
          dropzoneClassName="[&_[data-slot=image-upload-prompt]_svg]:mb-5"
          single
          showCount={false}
          emptyHint={`上传要复刻风格的参考图，最多 1 张，单张不超过 ${maxMb}MB`}
        />
      </SectionCard>

      {/* 标题由卡片承担；字段在本页为选填，不带必填星号 */}
      <SectionCard title="生成设置">
        <ProductFieldsGrid
          productName={productName}
          onProductNameChange={onProductNameChange}
          brand={brand}
          onBrandChange={onBrandChange}
          platform={platform}
          onPlatformChange={onPlatformChange}
          language={language}
          onLanguageChange={onLanguageChange}
          required={false}
          showTitle={false}
        />
      </SectionCard>
    </>
  );
}

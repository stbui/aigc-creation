import { Button, type ToolAsset } from './components';
import { assetThumbUrl } from './api';

interface ProductSkuTemplatePreviewProps {
  template: ToolAsset;
  onPreview: (url: string) => void;
  onEditRegions: () => void;
  /** 重新选择模板图（复用模板卡片自持的隐藏 input） */
  onReupload: () => void;
}

/** 已选模板图：缩略预览 + 重新框选 / 重新上传。 */
export function ProductSkuTemplatePreview({
  template,
  onPreview,
  onEditRegions,
  onReupload,
}: ProductSkuTemplatePreviewProps) {
  return (
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
        <Button htmlType="button" variant="secondary" className="min-w-22" onClick={onReupload}>
          重新上传
        </Button>
      </div>
    </div>
  );
}

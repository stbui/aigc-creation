import { ImagePlus } from 'lucide-react';

import { Button } from './components';

interface ProductSkuTemplateDropzoneProps {
  /** 打开文件选择框（点击 / 拖拽 / 粘贴都汇到页面同一条上传链路） */
  onPick: () => void;
}

/** 模板图空态：大块点击区，文案说明支持点击、拖拽与粘贴。 */
export function ProductSkuTemplateDropzone({ onPick }: ProductSkuTemplateDropzoneProps) {
  return (
    <Button
      htmlType="button"
      variant="outline"
      className="h-auto min-h-40 w-full flex-col gap-1.5 rounded-md border-dashed bg-muted px-4 py-4 whitespace-normal text-muted-foreground hover:border-brand max-[560px]:min-h-32.5"
      onClick={onPick}
    >
      <ImagePlus className="size-5.5 text-brand" />
      <strong className="text-xs font-medium text-foreground">点击或拖拽图片到此处上传</strong>
      <span className="text-xs font-normal">点击、拖拽或粘贴图片上传，最多 1 张</span>
    </Button>
  );
}

import { ImagePlus } from 'lucide-react';

import { ImageDropzone } from './components';

interface ProductSkuTemplateDropzoneProps {
  /** 打开文件选择框（点击 / 拖拽 / 粘贴都汇到页面同一条上传链路） */
  onPick: () => void;
  /** 拖拽落点：与点击共用同一条上传链路 */
  onFiles: (files: FileList) => void;
}

/** 模板图空态：大块可点击区，文案说明支持点击、拖拽与粘贴。 */
export function ProductSkuTemplateDropzone({ onPick, onFiles }: ProductSkuTemplateDropzoneProps) {
  return (
    <ImageDropzone
      title="点击或拖拽图片到此处上传"
      hint="点击、拖拽或粘贴图片上传，最多 1 张"
      icon={<ImagePlus aria-hidden />}
      onClick={onPick}
      onFiles={onFiles}
    />
  );
}
import { Upload } from 'lucide-react';

import { useUploadLimits } from '../../context/UploadLimitsContext';
import { ImageUploadTrigger } from './components';

interface ProductSkuReferenceUploadButtonProps {
  /** 该区域的参考图正在上传；按钮进入禁用并显示「上传中…」 */
  busy: boolean;
  onPick: (file: File | undefined) => void;
}

/**
 * 变体区域内的「上传参考图」入口。
 *
 * 隐藏 input、打开选择与 value 清空由共享 `ImageUploadTrigger` 承担，
 * 页面只拿到选中的文件。
 */
export function ProductSkuReferenceUploadButton({
  busy,
  onPick,
}: ProductSkuReferenceUploadButtonProps) {
  const { accept } = useUploadLimits();

  return (
    <ImageUploadTrigger
      icon={<Upload size={12} aria-hidden />}
      accept={accept}
      disabled={busy}
      onFiles={(files) => onPick(Array.from(files)[0])}
    >
      {busy ? '上传中…' : '上传参考图'}
    </ImageUploadTrigger>
  );
}

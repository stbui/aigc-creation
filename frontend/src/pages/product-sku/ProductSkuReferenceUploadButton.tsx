import { useRef } from 'react';
import { Upload } from 'lucide-react';

import { SUPPORTED_IMAGE_ACCEPT } from './constants';
import { Button } from './components';

interface ProductSkuReferenceUploadButtonProps {
  /** 该区域的参考图正在上传；按钮进入禁用并显示「上传中…」 */
  busy: boolean;
  onPick: (file: File | undefined, input: HTMLInputElement) => void;
}

/**
 * 变体区域内的「上传参考图」入口。
 *
 * 隐藏文件选择框由本组件自持，页面只拿到选中的文件与 input 引用
 * （后者用于清空 value，允许重复选择同一文件）。
 */
export function ProductSkuReferenceUploadButton({
  busy,
  onPick,
}: ProductSkuReferenceUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button
        htmlType="button"
        variant="link"
        size="xs"
        disabled={busy}
        className="h-auto gap-1 border-0 bg-transparent p-0 text-xs font-normal text-muted-foreground underline underline-offset-4 hover:text-brand"
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-3" />
        {busy ? '上传中…' : '上传参考图'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_IMAGE_ACCEPT}
        hidden
        disabled={busy}
        onChange={(event) => onPick(event.target.files?.[0], event.currentTarget)}
      />
    </>
  );
}

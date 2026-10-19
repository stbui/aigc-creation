import { useEffect } from 'react';

/**
 * 剪贴板粘贴上传 —— 工具页通用能力（参考站上传区支持直接 Ctrl/Cmd+V 贴图）。
 *
 * 2026-10-19 抽取。此前同一段 useEffect 在 5 处重复
 * (ToolShell + ProductKit / ProductDetail / ViralClone / FreeCreation)，
 * 差异仅在 onFiles 回调，行为完全一致。
 *
 * 过滤非图片文件：剪贴板里常见的是截图与文件拖拽混入的文本/路径，
 * 直接透传会让上传接口拿到非图片 MIME 而报错。
 */
export function usePasteUpload(onFiles: (files: File[]) => void | Promise<void>): void {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        e.preventDefault();
        void onFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFiles]);
}
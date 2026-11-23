import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
  type RefObject,
} from 'react';

export interface UseImageUploadAreaOptions {
  disabled: boolean;
  /** 已选数量达到上限 */
  room: boolean;
  /** 已有图片 */
  filled: boolean;
  /** 已选区由调用方自定义渲染；此时命中区不接管缩略图点击 */
  renderPreviewProvided: boolean;
  /** 已选满时仍允许点击命中区重新开框（单图「替换」场景） */
  replaceOnClick?: boolean;
  /** 选中 / 拖拽落下的文件；校验、上传与额度仍由调用方负责 */
  onFiles: (files: FileList | File[]) => void;
}

export interface UseImageUploadAreaResult {
  inputRef: RefObject<HTMLInputElement | null>;
  dragging: boolean;
  /** 打开文件选择；不受数量上限拦截，供「重新上传」入口复用 */
  open: () => void;
  onZoneClick: (event: MouseEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * 图片上传区的 UI 状态与交互：隐藏 input 引用、拖拽高亮、点击 / 拖拽 / 选择事件。
 *
 * 只产出「拿到文件」这一意图，不校验、不上传、不读写业务状态 —— 这些仍归页面
 * 或业务 hook（`useImageUpload` / `useToolUploadSlots`）。
 */
export function useImageUploadArea({
  disabled,
  room,
  filled,
  renderPreviewProvided,
  replaceOnClick = false,
  onFiles,
}: UseImageUploadAreaOptions): UseImageUploadAreaResult {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const open = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const pick = useCallback(
    (files: FileList | null) => {
      if (files) onFiles(files);
    },
    [onFiles],
  );

  const onZoneClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (filled && renderPreviewProvided && !replaceOnClick) return;
      if (!(event.target instanceof Element)) return;
      if (event.target === inputRef.current) return;
      if (event.target.closest('button, a, label, input')) return;
      if (room || (replaceOnClick && filled)) open();
    },
    [filled, renderPreviewProvided, replaceOnClick, room, open],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      setDragging(true);
    },
    [disabled],
  );

  const onDragLeave = useCallback(() => setDragging(false), []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      pick(event.dataTransfer.files);
    },
    [disabled, pick],
  );

  const onInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      pick(event.target.files);
      event.target.value = '';
    },
    [pick],
  );

  return {
    inputRef,
    dragging,
    open,
    onZoneClick,
    onDragOver,
    onDragLeave,
    onDrop,
    onInputChange,
  };
}

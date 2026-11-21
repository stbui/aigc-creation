import { useRef } from 'react';
import { ImagePlus, Upload } from 'lucide-react';

import { MAX_FILES, type Phase, type Picked } from './constants';
import { SUPPORTED_IMAGE_ACCEPT } from './utils';
import { MobileUploadPreview } from './MobileUploadPreview';

interface MobileUploadEditorProps {
  picked: Picked[];
  phase: Phase;
  notice: string | null;
  error: string | null;
  totalSize: number;
  onFiles: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onSubmit: () => void;
}

/** 反馈行（提示 / 错误）共用皮肤 */
const NOTICE = 'mx-0 mt-0 mb-3.5 rounded-[9px] px-3 py-2.5 text-[13px] leading-[1.6]';

/** 选图态主体：页头、提示、已选网格、隐藏文件框与确认上传。 */
export function MobileUploadEditor({
  picked,
  phase,
  notice,
  error,
  totalSize,
  onFiles,
  onRemove,
  onMove,
  onSubmit,
}: MobileUploadEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <header className="flex items-center gap-3 text-[color:var(--mup-text-brand-1)]">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-[var(--mup-surface-brand-2)] p-[9px]">
          <ImagePlus size={26} />
        </span>
        <div>
          <small className="block text-xs leading-4 text-[color:var(--mup-text-5)]">手机扫码上传</small>
          <h1 className="mx-0 mt-0.5 mb-0 text-[22px] leading-7 text-[color:var(--mup-text-2)]">
            上传图片到电脑
          </h1>
        </div>
      </header>

      <p className="mx-0 my-[18px] rounded-[10px] bg-[var(--mup-surface-brand-4)] px-[13px] py-[11px] text-[13px] leading-[1.6] text-[color:var(--mup-text-3)]">
        使用手机扫描电脑上的二维码，在本页选择或拍摄图片，图片会自动发送到电脑端的参考图位。
      </p>

      {notice && (
        <p className={`${NOTICE} bg-[var(--mup-surface-success)] text-[color:var(--mup-text-success-1)]`}>
          {notice}
        </p>
      )}
      {error && (
        <p className={`${NOTICE} bg-[var(--mup-surface-danger)] text-[color:var(--mup-text-danger-1)]`}>
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2.5 max-[520px]:grid-cols-2">
        {picked.map((item, index) => (
          <MobileUploadPreview
            key={item.url}
            item={item}
            index={index}
            total={picked.length}
            onRemove={() => onRemove(index)}
            onMove={(delta) => onMove(index, delta)}
          />
        ))}

        {picked.length < MAX_FILES && (
          <button
            type="button"
            className="relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-[5px] overflow-hidden rounded-lg border-[1.5px] border-dashed border-[var(--mup-border-brand)] bg-[var(--mup-surface-drag)] p-0 font-[inherit] text-[color:var(--mup-text-brand-2)]"
            onClick={() => inputRef.current?.click()}
            disabled={phase === 'uploading'}
          >
            <ImagePlus size={22} />
            <strong className="text-[13px]">选择图片</strong>
            <small className="text-xs text-[color:var(--mup-text-4)]">可多选</small>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {picked.length > 0 && (
        <p className="mx-0 mt-2.5 mb-0 text-center text-xs leading-[18px] text-[color:var(--mup-text-5)]">
          已选 {picked.length} 张 · 共 {(totalSize / 1024).toFixed(0)} KB
        </p>
      )}

      <button
        type="button"
        className="mt-5 flex h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-[linear-gradient(135deg,var(--surface-brand-2),var(--mup-surface-brand-1))] font-[inherit] text-[15px] font-bold text-card disabled:cursor-not-allowed disabled:opacity-45"
        onClick={onSubmit}
        disabled={!picked.length || phase === 'uploading'}
      >
        <Upload size={15} />
        {phase === 'uploading' ? '上传中…' : '确认上传'}
      </button>
    </>
  );
}

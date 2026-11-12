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
      <header>
        <span className="mup-icon">
          <ImagePlus size={26} />
        </span>
        <div>
          <small>手机扫码上传</small>
          <h1>上传图片到电脑</h1>
        </div>
      </header>

      <p className="mup-tip">
        使用手机扫描电脑上的二维码，在本页选择或拍摄图片，图片会自动发送到电脑端的参考图位。
      </p>

      {notice && <p className="mup-message">{notice}</p>}
      {error && <p className="mup-error">{error}</p>}

      <div className="mup-grid">
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
            className="mup-picker"
            onClick={() => inputRef.current?.click()}
            disabled={phase === 'uploading'}
          >
            <ImagePlus size={22} />
            <strong>选择图片</strong>
            <small>可多选</small>
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
        <p className="mup-summary">
          已选 {picked.length} 张 · 共 {(totalSize / 1024).toFixed(0)} KB
        </p>
      )}

      <button
        type="button"
        className="mup-submit"
        onClick={onSubmit}
        disabled={!picked.length || phase === 'uploading'}
      >
        <Upload size={15} />
        {phase === 'uploading' ? '上传中…' : '确认上传'}
      </button>
    </>
  );
}

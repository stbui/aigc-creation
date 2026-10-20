import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App } from 'antd';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, ImagePlus, Upload } from 'lucide-react';
import { mobileUploadApi } from '../lib/api';

/**
 * 手机端上传落地页 —— 1:1 复刻参考站 (ijihua.cn) 扫码后打开的
 * `mobile-upload-page` 页面。
 *
 * ## 参考站实拍数值 (2026-10-20 取证: 线上样式表 index-glaqVozH.css)
 *
 *   page        min-height 100dvh, 渐变背景
 *               linear-gradient(150deg, #f1edff 0%, #faf9ff 44%, #eef7ff 100%)
 *               居中, padding 20, 色 #282431
 *   card        宽 min(520px, 100%), 圆角 22, 底 #fffffff5, 边框 #fffc
 *               padding 24, 阴影 0 24px 70px #46378224
 *   header      flex, gap 12, 色 #6d55dc; 图标 44x44 底 #eeeaff 圆角 12 padding 9
 *   h1          22px, 色 #292533
 *   tip         底 #f6f4fb, 圆角 10, margin 18px 0, padding 11px 13px, 13px/1.6 色 #706b78
 *   message     圆角 9, 底 #edf8f1 色 #24824b (成功)
 *   error       圆角 9, 底 #fff0f1 色 #bd3540
 *   grid        repeat(3, 1fr), gap 10
 *   preview/picker  aspect-ratio 1, 圆角 12
 *   picker      虚线 1.5px #bdb4e8, 底 #f8f6ff, 色 #715cd2, 居中
 *   preview>span 左上角序号圆标 22x22 底 #14121eb3
 *   preview .remove 右上角删除 26x26 底 #14121eb3
 *   preview .order 右下角排序按钮组 29x27 底 #14121eb8
 *   preview>i   右下角已上传绿标 28x28 底 #2fad63
 *   preview.uploaded 绿色描边 2px #2fad63
 *   submit      渐变 linear-gradient(135deg,#765ce7,#5e48c7), 圆角 12,
 *               高 46, 字 15px 700, 宽 100%, margin-top 20
 *   expiry      12px 色 #9993a5 居中 margin-top 12
 *   loading/success/error 态: 居中列, min-height 280
 *
 * ## 文案 (取自参考站 bundle 反混淆)
 *
 *   「使用手机扫描二维码」/「扫一扫二维码」/「选择图片」/「确认上传」
 *   「图片已自动压缩，压缩到 X」/「已从手机接收 N 张」/「N 秒后失效」
 *   「手机正在上传，请…」「手机可能已经开始…」「二维码信息不完整」
 *
 * ## 与参考站的差异 (如实说明)
 *
 * 参考站有「认领」环节 (claimImageAsset): 手机端上传的图片先进暂存,
 * 由电脑端确认认领后才入库。本项目**一步到位** —— 手机端上传即入用户素材库,
 * 电脑端轮询到即回填参考图位。少一次交互, 但少了"电脑端不认领就白传"的可能。
 */

type Phase = 'pick' | 'uploading' | 'success' | 'error';

interface Picked {
  file: File;
  url: string;
  /** 压缩后的大小 (字节); 未压缩时为原大小 */
  size: number;
  /** 是否被压缩过 */
  compressed: boolean;
  /** 压缩到的最长边 */
  edge?: number;
}

export function MobileUploadPage() {
  const { message } = App.useApp();
  const [params] = useSearchParams();
  const sessionId = params.get('session') ?? '';
  const token = params.get('token') ?? '';

  const [picked, setPicked] = useState<Picked[]>([]);
  const [phase, setPhase] = useState<Phase>('pick');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const missingParams = !sessionId || !token;

  // 卸载时释放 objectURL
  useEffect(
    () => () => {
      for (const p of picked) URL.revokeObjectURL(p.url);
    },
    [picked],
  );

  /** 选择图片 (可多选) */
  const onFiles = useCallback(
    async (list: FileList | File[] | null) => {
      if (!list) return;
      const files = Array.from(list).filter((f) => f.type.startsWith('image/'));
      if (!files.length) {
        setError('请选择图片文件');
        return;
      }
      if (files.length > MAX_FILES) {
        setError(`一次最多上传 ${MAX_FILES} 张`);
        return;
      }
      setError(null);
      setNotice(null);

      // 逐张压缩 (参考站: 「图片已自动压缩，压缩到 X」)
      const results: Picked[] = [];
      let compressedCount = 0;
      let minEdge = Infinity;
      for (const f of files) {
        if (f.size > MAX_MB * 1024 * 1024) {
          setError(`单张不超过 ${MAX_MB}MB`);
          return;
        }
        const c = await compressImage(f);
        if (c.compressed) {
          compressedCount++;
          minEdge = Math.min(minEdge, c.edge ?? 0);
        }
        results.push({
          file: c.file,
          url: URL.createObjectURL(c.file),
          size: c.file.size,
          compressed: c.compressed,
          edge: c.edge,
        });
      }
      setPicked((prev) => [...prev, ...results]);
      if (compressedCount > 0) {
        setNotice(
          `图片已自动压缩，压缩到 ${Number.isFinite(minEdge) ? minEdge : MAX_EDGE}px 以内` +
            (compressedCount < results.length ? `（${compressedCount} 张被压缩）` : ''),
        );
      }
    },
    [],
  );

  /** 移除某张 */
  const removeAt = (idx: number) => {
    setPicked((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  /** 调整顺序 —— 参考站的左右箭头, 顺序即电脑端参考图位的构图顺序 */
  const move = (idx: number, dir: -1 | 1) => {
    setPicked((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  /** 提交 */
  const submit = useCallback(async () => {
    if (!picked.length) {
      setError('请先选择图片');
      return;
    }
    setPhase('uploading');
    setError(null);
    try {
      await mobileUploadApi.receive(
        sessionId,
        token,
        picked.map((p) => p.file),
      );
      setPhase('success');
    } catch (e) {
      setPhase('error');
      setError((e as Error).message || '上传失败');
    }
  }, [picked, sessionId, token]);

  const totalSize = useMemo(() => picked.reduce((sum, p) => sum + p.size, 0), [picked]);

  if (missingParams) {
    return (
      <div className="mup">
        <div className="mup-card is-error">
          <AlertCircle size={44} />
          <p>二维码信息不完整，请重新扫码</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mup">
      <div className={`mup-card${phase === 'success' ? ' is-success' : phase === 'error' ? ' is-error' : ''}`}>
        {phase === 'success' ? (
          <>
            <CheckCircle2 size={44} />
            <p>已从手机接收 {picked.length} 张图片，请回到电脑端</p>
          </>
        ) : phase === 'error' ? (
          <>
            <AlertCircle size={44} />
            <p>{error ?? '上传失败'}</p>
            <button type="button" className="mup-submit" onClick={() => setPhase('pick')}>
              重新选择图片
            </button>
          </>
        ) : (
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
              {picked.map((p, i) => (
                <div key={p.url} className="mup-preview">
                  <img src={p.url} alt={p.file.name} />
                  <span>{i + 1}</span>
                  <button
                    type="button"
                    className="mup-remove"
                    aria-label={`移除第 ${i + 1} 张`}
                    onClick={() => removeAt(i)}
                  >
                    ×
                  </button>
                  <div className="mup-order">
                    <button
                      type="button"
                      aria-label={`第 ${i + 1} 张前移`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`第 ${i + 1} 张后移`}
                      disabled={i === picked.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
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
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = '';
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
              onClick={() => void submit()}
              disabled={!picked.length || phase === 'uploading'}
            >
              <Upload size={15} />
              {phase === 'uploading' ? '上传中…' : '确认上传'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** 一次最多上传张数 —— 与后端一致 */
const MAX_FILES = 9;
/** 单张上限 (MB) */
const MAX_MB = 20;
/** 压缩后的最长边 (像素) */
const MAX_EDGE = 1600;
/** 压缩后的 JPEG 质量 */
const QUALITY = 0.85;

/**
 * 压缩图片 —— canvas 重绘, 输出 JPEG。
 *
 * ⚠️ **压缩失败必须回退传原图**: 有些手机相册存的是 HEIC, 浏览器解不出,
 * 若此处直接抛错, 用户就彻底传不上图了 —— 而原图后端是能收的。
 */
async function compressImage(file: File): Promise<{ file: File; compressed: boolean; edge?: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { file, compressed: false };
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    if (!blob) return { file, compressed: false };

    // 压完反而更大 (本来就是小图) 就用原图
    if (blob.size >= file.size) return { file, compressed: false };

    return {
      file: new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }),
      compressed: true,
      edge: Math.max(w, h),
    };
  } catch {
    return { file, compressed: false };
  }
}

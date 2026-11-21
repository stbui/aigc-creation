import { useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

import { MOBILE_UPLOAD_META } from './constants';
import { useDocumentMeta, useMobileUpload } from './hooks';
import { MobileUploadEditor } from './MobileUploadEditor';

/**
 * 手机端上传落地页
 *
 * 电脑端生成二维码 → 手机扫码进入本页 → 选图 / 压缩 → 回传素材库。
 * 与参考站的差异（如实说明）：参考站有「认领」环节，本项目一步到位 ——
 * 手机端上传即入用户素材库，电脑端轮询到即回填参考图位。
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：选图态 `MobileUploadEditor`
 * （单张 `MobileUploadPreview`），压缩与 objectURL 生命周期落 `utils.ts` /
 * `hooks.ts` 的 `useMobileUpload`；成功 / 失败 / 参数缺失三个终态留在本文件。
 */

/** 落地页外壳：渐变底 + 居中卡片 */
const PAGE =
  'grid min-h-[100dvh] box-border items-center justify-items-center p-5 text-[color:var(--mup-text-1)] bg-[linear-gradient(150deg,var(--mup-surface-brand-3)_0%,var(--mup-surface-brand-5)_44%,var(--mup-surface-info)_100%)] max-[520px]:items-start max-[520px]:p-3';

/** 卡片：宽上限 520，窄屏收紧圆角与内边距 */
const CARD =
  'box-border w-[min(520px,100%)] rounded-[22px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(70,55,130,0.14)] max-[520px]:mt-2 max-[520px]:rounded-[18px] max-[520px]:p-[18px]';

/** 成功 / 失败终态：居中列 */
const STATE_CARD = 'flex min-h-[280px] flex-col items-center justify-center gap-3 text-center';

export function MobileUploadPage() {
  useDocumentMeta(MOBILE_UPLOAD_META.title, MOBILE_UPLOAD_META.description);
  const [params] = useSearchParams();
  const sessionId = params.get('session') ?? '';
  const token = params.get('token') ?? '';
  const { picked, phase, setPhase, error, notice, totalSize, addFiles, removeAt, move, submit } =
    useMobileUpload(sessionId, token);

  if (!sessionId || !token) {
    return (
      <div className={PAGE}>
        <div className={`${CARD} ${STATE_CARD}`}>
          <AlertCircle size={44} className="text-[color:var(--mup-text-danger-2)]" />
          <p className="m-0 text-sm text-[color:var(--text-7)]">二维码信息不完整，请重新扫码</p>
        </div>
      </div>
    );
  }

  const terminal = phase === 'success' || phase === 'error';

  return (
    <div className={PAGE}>
      <div className={`${CARD}${terminal ? ` ${STATE_CARD}` : ''}`}>
        {phase === 'success' ? (
          <>
            <CheckCircle2 size={44} className="text-[color:var(--mup-text-success-2)]" />
            <p className="m-0 text-sm text-[color:var(--text-7)]">
              已从手机接收 {picked.length} 张图片，请回到电脑端
            </p>
          </>
        ) : phase === 'error' ? (
          <>
            <AlertCircle size={44} className="text-[color:var(--mup-text-danger-2)]" />
            <p className="m-0 text-sm text-[color:var(--text-7)]">{error ?? '上传失败'}</p>
            <button
              type="button"
              className="mt-5 flex h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-[linear-gradient(135deg,var(--surface-brand-2),var(--mup-surface-brand-1))] font-[inherit] text-[15px] font-bold text-card"
              onClick={() => setPhase('pick')}
            >
              重新选择图片
            </button>
          </>
        ) : (
          <MobileUploadEditor
            picked={picked}
            phase={phase}
            notice={notice}
            error={error}
            totalSize={totalSize}
            onFiles={(files) => void addFiles(files)}
            onRemove={removeAt}
            onMove={move}
            onSubmit={() => void submit()}
          />
        )}
      </div>
    </div>
  );
}

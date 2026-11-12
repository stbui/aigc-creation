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
export function MobileUploadPage() {
  useDocumentMeta(MOBILE_UPLOAD_META.title, MOBILE_UPLOAD_META.description);
  const [params] = useSearchParams();
  const sessionId = params.get('session') ?? '';
  const token = params.get('token') ?? '';
  const { picked, phase, setPhase, error, notice, totalSize, addFiles, removeAt, move, submit } =
    useMobileUpload(sessionId, token);

  if (!sessionId || !token) {
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
      <div
        className={`mup-card${phase === 'success' ? ' is-success' : phase === 'error' ? ' is-error' : ''}`}
      >
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

import type { MultiFusionSlot } from './constants';

/**
 * 图位标题右侧的两个补图入口（素材库导入 / 手机上传）。
 *
 * 主体位与搭配位共用同一组入口，只有提示语随图位变化；点击后由页面
 * 记住目标位，再打开对应的弹窗。
 */
export function MultiFusionSlotActions({
  target,
  onOpenLibrary,
  onOpenMobile,
}: {
  target: MultiFusionSlot;
  onOpenLibrary: (target: MultiFusionSlot) => void;
  onOpenMobile: (target: MultiFusionSlot) => void;
}) {
  const isSubject = target === 'subject';
  return (
    <span className="multi-image-fusion-field-actions">
      <button
        type="button"
        className="multi-image-fusion-field-link"
        title={isSubject ? '从已上传的素材里选一张作为主体图' : '从已上传的素材里挑选搭配图'}
        onClick={() => onOpenLibrary(target)}
      >
        从素材库导入
      </button>
      <button
        type="button"
        className="multi-image-fusion-field-link multi-image-fusion-mobile-upload-link"
        title={
          isSubject
            ? '扫码在手机上选择图片，接收后进入主体图位'
            : '扫码在手机上选择图片，接收后进入搭配图位'
        }
        onClick={() => onOpenMobile(target)}
      >
        手机上传
      </button>
    </span>
  );
}

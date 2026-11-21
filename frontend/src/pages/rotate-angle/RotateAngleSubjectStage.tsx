interface RotateAngleSubjectStageProps {
  /** 已上传图片地址；null 时六个面显示方位文字 */
  previewImage: string | null;
  yaw: number;
  pitch: number;
  zoom: number;
}

/** 立方体单面的共用皮肤：六面只有位移不同 */
const CUBE_FACE =
  'absolute inset-0 grid place-items-center overflow-hidden border border-[var(--tool-border-3)] bg-card text-[13px] font-bold text-[color:var(--tool-text-6)] [backface-visibility:hidden]';

/**
 * 主体模式的 CSS 3D 立方体舞台。
 *
 * transform 只做视觉近似: 立方体按 `rotateX / rotateY` 转动，
 * 正面图片再按 `zoom` 缩放；真实生成仍以提交参数为准。
 */
export function RotateAngleSubjectStage({ previewImage, yaw, pitch, zoom }: RotateAngleSubjectStageProps) {
  return (
    <div className="grid size-full place-items-center [perspective:440px]">
      <div
        className="relative size-[104px] transition-transform duration-200 ease-out [transform-style:preserve-3d]"
        style={{ transform: `rotateX(${-pitch * 0.6}deg) rotateY(${yaw}deg)` }}
      >
        <span className={`${CUBE_FACE} [transform:translateZ(52px)]`}>
          {previewImage ? (
            <img
              className="size-full bg-card object-contain object-center transition-transform duration-[160ms] ease-out pointer-events-none [-webkit-user-drag:none]"
              src={previewImage}
              alt=""
              style={{ transform: `scale(${zoom})` }}
              draggable={false}
            />
          ) : (
            '前'
          )}
        </span>
        <span className={`${CUBE_FACE} [transform:rotateY(180deg)_translateZ(52px)]`}>后</span>
        <span className={`${CUBE_FACE} [transform:rotateY(-90deg)_translateZ(52px)]`}>左</span>
        <span className={`${CUBE_FACE} [transform:rotateY(90deg)_translateZ(52px)]`}>右</span>
        <span className={`${CUBE_FACE} [transform:rotateX(90deg)_translateZ(52px)]`}>上</span>
        <span className={`${CUBE_FACE} [transform:rotateX(-90deg)_translateZ(52px)]`}>下</span>
      </div>
    </div>
  );
}

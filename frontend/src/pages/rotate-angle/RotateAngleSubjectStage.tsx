interface RotateAngleSubjectStageProps {
  /** 已上传图片地址；null 时六个面显示方位文字 */
  previewImage: string | null;
  yaw: number;
  pitch: number;
  zoom: number;
}

/**
 * 主体模式的 CSS 3D 立方体舞台。
 *
 * transform 只做视觉近似: 立方体按 `rotateX / rotateY` 转动，
 * 正面图片再按 `zoom` 缩放；真实生成仍以提交参数为准。
 */
export function RotateAngleSubjectStage({ previewImage, yaw, pitch, zoom }: RotateAngleSubjectStageProps) {
  return (
    <div className="rotate-angle-subject-stage">
      <div
        className="rotate-angle-cube"
        style={{ transform: `rotateX(${-pitch * 0.6}deg) rotateY(${yaw}deg)` }}
      >
        <span className="rotate-angle-cube-face front">
          {previewImage ? (
            <img src={previewImage} alt="" style={{ transform: `scale(${zoom})` }} draggable={false} />
          ) : (
            '前'
          )}
        </span>
        <span className="rotate-angle-cube-face back">后</span>
        <span className="rotate-angle-cube-face left">左</span>
        <span className="rotate-angle-cube-face right">右</span>
        <span className="rotate-angle-cube-face top">上</span>
        <span className="rotate-angle-cube-face bottom">下</span>
      </div>
    </div>
  );
}

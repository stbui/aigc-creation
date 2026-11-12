import { ORBIT_LINE_COUNT, ORBIT_LINE_STEP_DEG, type NudgeDirection } from './constants';
import { orbitNeedleOf } from './utils';

interface RotateAngleCameraStageProps {
  /** 已上传图片地址；null 时不渲染轨道上的主体 */
  previewImage: string | null;
  yaw: number;
  pitch: number;
  zoom: number;
  onNudge: (direction: NudgeDirection) => void;
}

/**
 * 摄像头模式舞台：轨道线 + 指针 + 相机 + 四个方向键。
 *
 * 轨道线数量与间隔来自 `constants.ts`；指针与相机坐标由 `orbitNeedleOf`
 * 按 yaw / pitch 球面投影得到，四个方向键各自只改一个角度。
 */
export function RotateAngleCameraStage({
  previewImage,
  yaw,
  pitch,
  zoom,
  onNudge,
}: RotateAngleCameraStageProps) {
  const { orbitZ, needleX, needleY } = orbitNeedleOf(yaw, pitch);

  return (
    <div className="rotate-angle-camera-stage">
      <div className="rotate-angle-orbit">
        <div
          className="rotate-angle-wire"
          style={{
            transform: `rotateX(${pitch * 0.38}deg) rotateY(${yaw * 0.22}deg) rotateZ(${-yaw * 0.12}deg)`,
          }}
        >
          {Array.from({ length: ORBIT_LINE_COUNT }, (_, index) => (
            <i key={index} style={{ ['--line-angle' as string]: `${index * ORBIT_LINE_STEP_DEG}deg` }} />
          ))}
        </div>
      </div>
      <div
        className="rotate-angle-needle"
        style={{
          width: `${Math.hypot(needleX, needleY)}px`,
          transform: `rotate(${(Math.atan2(needleY, needleX) * 180) / Math.PI}deg)`,
        }}
      />
      {previewImage && (
        <div
          className="rotate-angle-orbit-subject"
          style={{ transform: `translate(-50%, -50%) scale(${zoom})` }}
        >
          <img src={previewImage} alt="" draggable={false} />
        </div>
      )}
      <div
        className="rotate-angle-camera"
        style={{
          transform: `translate(-50%, -50%) translate(${needleX}px, ${needleY}px) rotate(${yaw * 0.7}deg) scale(${0.82 + Math.max(0, orbitZ) * 0.18})`,
        }}
      >
        <span className="rotate-angle-camera-body">
          <i />
        </span>
      </div>
      {/* 方向键各自处理点击，pointerdown 不再冒泡到整块预览拖拽 */}
      <button
        type="button"
        className="orbit-arrow left"
        aria-label="向左旋转"
        title="向左旋转"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onNudge('left')}
      >
        ‹
      </button>
      <button
        type="button"
        className="orbit-arrow right"
        aria-label="向右旋转"
        title="向右旋转"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onNudge('right')}
      >
        ›
      </button>
      <button
        type="button"
        className="orbit-arrow up"
        aria-label="向上倾斜"
        title="向上倾斜"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onNudge('up')}
      >
        ⌃
      </button>
      <button
        type="button"
        className="orbit-arrow down"
        aria-label="向下倾斜"
        title="向下倾斜"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onNudge('down')}
      >
        ⌄
      </button>
    </div>
  );
}

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

/** 四个方向键：只有定位与位移不同，外圈皮肤一致 */
const ARROW_BASE =
  'absolute grid size-7 cursor-pointer place-items-center rounded-full border border-border bg-card p-0 text-sm leading-none text-[color:var(--text-muted)] hover:border-brand-light hover:text-brand';

const ARROWS: ReadonlyArray<{ id: NudgeDirection; glyph: string; label: string; pos: string }> = [
  { id: 'left', glyph: '‹', label: '向左旋转', pos: 'top-1/2 left-3 -translate-y-1/2' },
  { id: 'right', glyph: '›', label: '向右旋转', pos: 'top-1/2 right-3 -translate-y-1/2' },
  { id: 'up', glyph: '⌃', label: '向上倾斜', pos: 'top-3 left-1/2 -translate-x-1/2' },
  { id: 'down', glyph: '⌄', label: '向下倾斜', pos: 'bottom-3 left-1/2 -translate-x-1/2' },
];

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
    <div className="relative grid size-full place-items-center overflow-hidden">
      <div className="relative size-[140px] rounded-full border border-dashed border-[var(--border-dot)] transition-transform duration-200 ease-out [transform-style:preserve-3d]">
        <div
          style={{
            transform: `rotateX(${pitch * 0.38}deg) rotateY(${yaw * 0.22}deg) rotateZ(${-yaw * 0.12}deg)`,
          }}
        >
          {Array.from({ length: ORBIT_LINE_COUNT }, (_, index) => (
            <i
              key={index}
              className="absolute top-1/2 left-1/2 h-px w-1/2 origin-left bg-[linear-gradient(90deg,var(--brand-light),rgba(128,100,246,0.05))] [transform:rotate(var(--line-angle,0deg))]"
              style={{ ['--line-angle' as string]: `${index * ORBIT_LINE_STEP_DEG}deg` }}
            />
          ))}
        </div>
      </div>
      <div
        className="absolute top-1/2 left-1/2 h-0.5 origin-left rounded-full bg-brand transition-transform duration-200 ease-out"
        style={{
          width: `${Math.hypot(needleX, needleY)}px`,
          transform: `rotate(${(Math.atan2(needleY, needleX) * 180) / Math.PI}deg)`,
        }}
      />
      {previewImage && (
        <div
          className="absolute top-1/2 left-1/2 z-2 size-11 overflow-hidden rounded-[var(--radius-tag)] border border-[var(--tool-border-3)] bg-card shadow-[0_2px_7px_rgba(57,48,75,0.08)] transition-transform duration-[60ms] ease-linear"
          style={{ transform: `translate(-50%, -50%) scale(${zoom})` }}
        >
          <img
            className="size-full object-cover pointer-events-none [-webkit-user-drag:none]"
            src={previewImage}
            alt=""
            draggable={false}
          />
        </div>
      )}
      <div
        className="absolute top-1/2 left-1/2 z-3 grid h-6 w-[30px] place-items-center pointer-events-none transition-transform duration-[80ms] ease-linear [filter:drop-shadow(0_2px_2px_rgba(57,48,75,0.12))]"
        style={{
          transform: `translate(-50%, -50%) translate(${needleX}px, ${needleY}px) rotate(${yaw * 0.7}deg) scale(${0.82 + Math.max(0, orbitZ) * 0.18})`,
        }}
      >
        <span className="relative block h-3.5 w-[22px] rounded-[var(--radius-tag)] border border-[var(--tool-border-2)] bg-[linear-gradient(var(--tool-surface-10),var(--tool-surface-2))] before:absolute before:-top-1 before:left-[5px] before:h-1 before:w-[9px] before:rounded-t-[3px] before:border before:border-b-0 before:border-[var(--tool-border-2)] before:bg-[var(--tool-surface-5)] before:content-[''] after:absolute after:top-[3px] after:right-1 after:size-1.5 after:rounded-full after:border after:border-[var(--tool-border-1)] after:bg-[var(--tool-surface-danger)] after:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.65)] after:content-['']">
          <i className="absolute top-px left-1 h-0.5 w-1.5 rounded-[2px] bg-[var(--tool-surface-danger)] [transform:rotate(-18deg)]" />
        </span>
      </div>
      {/* 方向键各自处理点击，pointerdown 不再冒泡到整块预览拖拽 */}
      {ARROWS.map((arrow) => (
        <button
          key={arrow.id}
          type="button"
          className={`${ARROW_BASE} ${arrow.pos}`}
          aria-label={arrow.label}
          title={arrow.label}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onNudge(arrow.id)}
        >
          {arrow.glyph}
        </button>
      ))}
    </div>
  );
}

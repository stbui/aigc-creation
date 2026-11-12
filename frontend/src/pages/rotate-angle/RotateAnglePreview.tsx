import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import {
  ARROW_STEP,
  DRAG_PITCH_FACTOR,
  DRAG_YAW_FACTOR,
  type NudgeDirection,
  type RotateTab,
} from './constants';
import { clampPitch, clampYaw } from './utils';
import { RotateAngleCameraStage } from './RotateAngleCameraStage';
import { RotateAngleSubjectStage } from './RotateAngleSubjectStage';

/** 预览拖拽起点快照：位移只相对按下时的角度计算，避免累积误差 */
interface DragOrigin {
  pointerId: number;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
}

interface RotateAnglePreviewProps {
  tab: RotateTab;
  yaw: number;
  pitch: number;
  zoom: number;
  previewImage: string | null;
  onYawChange: (value: number) => void;
  onPitchChange: (value: number) => void;
}

/**
 * 可拖拽的角度预览：按页签切换立方体 / 摄像头舞台。
 *
 * 拖拽与方向键都是预览内的局部交互，角度本身仍由页面持有；
 * 按下拖拽时用指针捕获，方向键与其它按钮不触发整块拖拽。
 */
export function RotateAnglePreview({
  tab,
  yaw,
  pitch,
  zoom,
  previewImage,
  onYawChange,
  onPitchChange,
}: RotateAnglePreviewProps) {
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<DragOrigin | null>(null);

  /** 方向键单步调整：左右改 yaw，上下改 pitch */
  const nudge = (direction: NudgeDirection) => {
    if (direction === 'left') onYawChange(clampYaw(yaw - ARROW_STEP));
    if (direction === 'right') onYawChange(clampYaw(yaw + ARROW_STEP));
    if (direction === 'up') onPitchChange(clampPitch(pitch + ARROW_STEP));
    if (direction === 'down') onPitchChange(clampPitch(pitch - ARROW_STEP));
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // 预览里的方向键 / 按钮各自处理点击，不应触发整块预览拖拽。
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw,
      pitch,
    };
    setDragging(true);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    onYawChange(Math.round(clampYaw(origin.yaw + (event.clientX - origin.x) * DRAG_YAW_FACTOR)));
    onPitchChange(Math.round(clampPitch(origin.pitch - (event.clientY - origin.y) * DRAG_PITCH_FACTOR)));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragOrigin.current = null;
    setDragging(false);
  };

  return (
    <div
      className={`rotate-angle-preview${dragging ? ' dragging' : ''}`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      title="拖拽预览可调整旋转与倾斜"
    >
      {tab === 'subject' ? (
        <RotateAngleSubjectStage previewImage={previewImage} yaw={yaw} pitch={pitch} zoom={zoom} />
      ) : (
        <RotateAngleCameraStage
          previewImage={previewImage}
          yaw={yaw}
          pitch={pitch}
          zoom={zoom}
          onNudge={nudge}
        />
      )}
    </div>
  );
}

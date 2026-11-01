import { NEEDLE_RADIUS, PITCH_MAX, PITCH_MIN, YAW_MAX, YAW_MIN } from './constants';

/**
 * 旋转角度页面的纯函数 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里只放不依赖 React 的角度夹取、轨道投影与参数拼装。
 */

/** 提交给 `useToolTask` 的高级设置 (与 `ToolShell` 回传一致) */
export interface RotateSettings {
  ratio: string;
  resolution: string;
}

/** 数值夹取 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 旋转值夹取 (滑杆 / 方向键 / 拖拽共用) */
export function clampYaw(value: number): number {
  return clamp(value, YAW_MIN, YAW_MAX);
}

/** 倾斜值夹取 (滑杆 / 方向键 / 拖拽共用) */
export function clampPitch(value: number): number {
  return clamp(value, PITCH_MIN, PITCH_MAX);
}

/** 摄像头模式的指针与相机位置 */
export interface OrbitNeedle {
  orbitX: number;
  orbitY: number;
  orbitZ: number;
  needleX: number;
  needleY: number;
}

/**
 * 按参考站的球面投影公式把 yaw / pitch 换算成轨道上的坐标。
 *
 * 摄像头模式不是把滑杆值直接当角度: pitch 的正负两半量程不同
 * (-30..0 与 0..60), 所以先归一化成 `pitchRatio`, 再由
 * `sqrt(1 - y²)` 得到水平半径; 指针长度与相机缩放都依赖这个分解。
 */
export function orbitNeedleOf(yaw: number, pitch: number): OrbitNeedle {
  const yawRad = (yaw * Math.PI) / 180;
  const pitchRatio = pitch >= 0 ? -pitch / 60 : -pitch / 30;
  const horizontal = Math.sqrt(Math.max(0, 1 - pitchRatio * pitchRatio));
  const orbitX = Math.sin(yawRad) * horizontal;
  const orbitY = pitchRatio;
  const orbitZ = Math.cos(yawRad) * horizontal;
  return {
    orbitX,
    orbitY,
    orbitZ,
    needleX: orbitX * NEEDLE_RADIUS,
    needleY: orbitY * NEEDLE_RADIUS,
  };
}

/** 结果标签: 三个滑杆当前值。 */
export function resultTagOf(yaw: number, pitch: number, zoom: number): string {
  return `旋转 ${yaw} · 倾斜 ${pitch} · 缩放 ${zoom.toFixed(2)}`;
}

/**
 * 把「模式 + 三个角度 + 高级设置」拼成旋转任务参数。
 *
 * 参考站主体模式使用相机坐标系，方位角与 UI 滑杆方向相反；
 * `imageRatio` 只在固定画幅时出现，原比例不带该字段。
 */
export function rotatePayload(
  tab: 'subject' | 'camera',
  yaw: number,
  pitch: number,
  zoom: number,
  settings: RotateSettings,
): Record<string, unknown> {
  return {
    azimuthDeg: tab === 'subject' ? -yaw : yaw,
    elevationDeg: pitch,
    zoomFactor: zoom,
    yaw,
    pitch,
    zoom,
    ...(settings.ratio !== 'original' ? { imageRatio: settings.ratio } : {}),
    ratio: settings.ratio,
    size: settings.resolution,
  };
}

/**
 * 旋转角度页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 三滑杆的取值范围、方向键步进与拖拽灵敏度在这里集中定义:
 * 滑杆、方向键、预览拖拽、参数夹取四处必须落在同一区间，
 * 否则同一次拖拽会在不同入口被夹到不同角度。
 *
 * 约定: `rotate-angle/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件或 `./components` —— 目录内新增共享常量时在这里补一行。
 */

/** 旋转模式: 主体 (立方体拖拽) / 摄像头 (轨道与方向键) */
export type RotateTab = 'subject' | 'camera';

/** 摄像头模式四个方向键的调整方向 */
export type NudgeDirection = 'left' | 'right' | 'up' | 'down';

/** 默认角度 (初始状态与重置共用, 避免两处漂移) */
export const DEFAULT_YAW = 0;
export const DEFAULT_PITCH = 0;
export const DEFAULT_ZOOM = 1;

/** 参考站方向键每次 ±5° */
export const ARROW_STEP = 5;

/** 预览拖拽灵敏度: 水平调旋转、垂直调倾斜 */
export const DRAG_YAW_FACTOR = 0.7;
export const DRAG_PITCH_FACTOR = 0.45;

/** 旋转 (yaw) 区间 */
export const YAW_MIN = -90;
export const YAW_MAX = 90;

/** 倾斜 (pitch) 区间: 向下 30°、向上 60°，与参考站滑杆一致 */
export const PITCH_MIN = -30;
export const PITCH_MAX = 60;

/** 缩放区间与步进 */
export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 1.2;
export const ZOOM_STEP = 0.01;

/** 摄像头模式轨道线的条数与间隔 */
export const ORBIT_LINE_COUNT = 12;
export const ORBIT_LINE_STEP_DEG = 15;

/** 相机指针的轨道半径 (px) */
export const NEEDLE_RADIUS = 66;
